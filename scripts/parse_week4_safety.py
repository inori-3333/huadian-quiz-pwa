#!/usr/bin/env python3
"""Read the week-four DOCX in document order and apply reviewed corrections."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
from zipfile import ZipFile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
GROUPS = ['一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六','十七','十八']

def extract(source):
    with ZipFile(source) as doc:
        root = ET.fromstring(doc.read('word/document.xml'))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    paragraphs = [''.join(t.text or '' for t in p.findall('.//w:t', ns)).strip() for p in root.findall('.//w:body//w:p', ns)]
    questions, current, section, group = [], None, None, None
    for index, text in enumerate(paragraphs, 1):
        if not text: continue
        if text in [g + '组' for g in GROUPS]:
            assert current is None
            group = GROUPS.index(text[:-1]) + 1
        elif text in ('选择题', '填空题', '判断题'):
            assert current is None
            section = text
        elif text.startswith('答案：'):
            assert current is not None
            raw = text.removeprefix('答案：').strip()
            body = ''.join(current.pop('parts'))
            options = []
            if section == '选择题':
                markers = list(re.finditer(r'(?<![A-Z])([A-D])(?:[.．、:：]|\s+|(?=[\u4e00-\u9fff]))', body))
                if markers:
                    assert [m[1] for m in markers] == list('ABCD'), body
                    options = [{'key': m[1], 'text': body[m.end():markers[i+1].start() if i+1<len(markers) else len(body)].strip()} for i,m in enumerate(markers)]
                    body = body[:markers[0].start()].strip()
            current.update(stem=body, options=options, answer=raw, answerRaw=raw)
            questions.append(current)
            current = None
        elif re.match(r'^\d+\.', text):
            assert current is None, text
            n, body = text.split('.', 1)
            current = dict(id=f'safetyweek4-{len(questions)+1:04d}', number=int(n), chapter=f'第{group}组', section=section, type={'选择题':'single','填空题':'fill','判断题':'judge'}[section], sourceParagraph=index, parts=[body.strip()])
        elif current is not None:
            current['parts'].append(text)
        else:
            assert text == '安规题库', text
    assert current is None
    assert len(questions) == 270
    for g in range(1,19):
        assert Counter(q['type'] for q in questions if q['chapter']==f'第{g}组') == {'single':5,'fill':5,'judge':5}
    return questions

def convert(source, corrections):
    raw = extract(source)
    questions = json.loads(json.dumps(raw))
    by_id = {q['id']:q for q in questions}
    for change in corrections:
        q = by_id[change['id']]
        for field, before in change['before'].items():
            assert q[field] == before, (change['id'], field, q[field], before)
        q.update(change['after'])
    references = json.loads((ROOT/'sources/week4/references.json').read_text())
    assert set(references) == set(by_id)
    for q in questions:
        q['sourceRef'] = references[q['id']]
        assert q['stem'] and q['answer']
        if q['type']=='single':
            assert [o['key'] for o in q['options']] == list('ABCD'), q['id']
            assert q['answer'] in 'ABCD' and len(q['answer'])==1
        if q['type']=='judge': assert q['answer'] in ('对','错')
        q['answerRaw'] = q['answer']
    return dict(id='safetyweek4', title='第四周安规考试', source='用户提供的《第四周安规题库（初版）.docx》，18组270题，已对照项目内2024版安规原文校对', questionCount=len(questions), chapters=[f'第{g}组' for g in range(1,19)], questions=questions)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('--extract-only',action='store_true')
    args=parser.parse_args()
    if args.extract_only:
        print(json.dumps(extract(args.source),ensure_ascii=False,indent=2))
    else:
        changes=json.loads((ROOT/'sources/week4/corrections.json').read_text())
        bank=convert(args.source,changes)
        (ROOT/'app/assets/data/safety-week4.json').write_text(json.dumps(bank,ensure_ascii=False,separators=(',',':'))+'\n')
        print(f"Imported {bank['questionCount']} questions")
