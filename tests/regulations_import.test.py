"""Importer regressions plus a repeatable audit against the retained Word source."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from xml.sax.saxutils import escape
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from parse_safety_regulations import Source, extract_source


class RegulationImportTests(unittest.TestCase):
    def test_split_units_annexes_wrappers_and_tables(self):
        def p(text):
            return f'<w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>'
        body = ''.join(p(text) for text in [
            '1 范围', '范围正文。', '12 焊接、切割和热处理作业',
            '12.3.1 气瓶存放:', '距离不少于', '100 m。',
            'f) 温度不应超过', '40', '℃。不得有取暖设备。',
            '12.3.2 平台高度', '0.6m,立柱间距2m。',
            'GB/T', '17889.2 等的要求。', '92', 'Q/CHD 85.1—2024',
            '跨页继续。', '12.3.3 前文。', '12.3.46kV 电气操作绝缘垫。', '12.3.5 后文。', '附录 I (规范性)', 'I.1 第一条。 I.2 第二条。',
            '附录 E', '现场勘察记录',
        ])
        body += '<w:sdt><w:sdtContent>' + p('表单说明不能遗漏。') + '</w:sdtContent></w:sdt>'
        body += '<w:tbl><w:tr><w:tc>' + p('第一行也是内容') + '</w:tc><w:tc>' + p('第一行也是内容') + '</w:tc></w:tr></w:tbl>'
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'source.docx'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('word/document.xml', f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>')
            audit = {}
            records = extract_source(Source('general', '', '', path), audit)
        clauses = {r['ref']: r['text'] for r in records if r['kind'] == 'clause'}
        self.assertIn('100 m。', clauses['12.3.1'])
        self.assertIn('40°C。不得有取暖设备。', clauses['12.3.1'])
        self.assertIn('0.6m', clauses['12.3.2'])
        self.assertIn('17889.2', clauses['12.3.2'])
        self.assertIn('跨页继续', clauses['12.3.2'])
        self.assertNotIn('92', clauses['12.3.2'])
        self.assertEqual(clauses['12.3.4'], '12.3.4 6kV 电气操作绝缘垫。')
        self.assertEqual(clauses['I.2'], 'I.2 第二条。')
        self.assertIn('表单说明不能遗漏', clauses['E'])
        self.assertEqual(audit['tableCells'], 2)
        self.assertEqual(audit['missingTextUnits'], 0)
        self.assertTrue(any('第一行也是内容;第一行也是内容' in r['text'] for r in records))

    def test_retained_source_exactly_reproduces_all_general_records(self):
        path = ROOT / 'sources/regulations/电力安全工作规程 第一部分：通用要求.docx'
        if not path.is_file():
            self.skipTest('Local Word source is intentionally excluded from Git')
        audit = {}
        records = extract_source(Source('general', '', '', path), audit)
        saved = json.loads((ROOT / 'app/assets/data/regulations.json').read_text())
        self.assertEqual(records, [r for r in saved['clauses'] if r['source'] == 'general'])
        self.assertEqual(audit['missingTextUnits'], 0)
        self.assertGreater(audit['checkedTextUnits'], 4000)
        self.assertEqual(audit['tableBlocks'], 47)

    def test_published_records_contain_complete_repaired_clauses(self):
        saved = json.loads((ROOT / 'app/assets/data/regulations.json').read_text())
        records = [r for r in saved['clauses'] if r['source'] == 'general']
        gas = next(r['text'] for r in records if r['ref'] == '12.3.1')
        for fragment in ['100 m。', 'c)', 'd)', 'e)', 'f)', 'g)', '40°C。不得有取暖设备。', '并保持通风良好。']:
            self.assertIn(fragment, gas)
        refs = {r['ref'] for r in records}
        self.assertFalse({'0.6', '17889.2', '7.2.1.76'} & refs)
        self.assertIn('7.2.1.7', refs)
        self.assertTrue({'I.2', 'F.3', 'E'} <= refs)


if __name__ == '__main__':
    unittest.main()
