---
version: alpha
name: 华电题库
description: 手机端离线刷题工具
colors:
  primary: '#1f5a49'
  ink: '#17312b'
  background: '#f6f3ea'
  surface: '#fffdf8'
  border: '#dedbd1'
typography:
  sans:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif'
rounded:
  card: '22px'
  image: '14px'
spacing:
  page-max: '760px'
  dialog-padding: '20px'
components:
  button: {}
  dialog: {}
---

# 华电题库 Design System

## Overview

面向华电培训学习者的中文离线刷题工具，主要用于手机。延续现有米白纸面与深绿色界面。首次提示以用户提供的森林黑猫插画为视觉中心，标题固定为 Powered by Group 15，下面仅列简短更新说明。

本文记录现有系统，运行时样式以 app/styles.css 为准，不生成独立主题。业务背景见 README.md。

## Colors

主色对应 --green，正文对应 --ink，纸面对应 --paper，浮层对应 --surface，边框对应 --line；所有颜色由 app/styles.css 的 :root 管理。

## Typography

沿用系统字体与中文回退。弹窗标题 16–20px，更新标题 14px，列表 13px、1.8 行高。

## Layout

主内容最大宽度 760px。首次弹窗最大宽度 400px，屏幕四周留 24px，过矮屏幕由弹窗内部滚动。图片保持完整正方形比例并预留尺寸。

## Elevation & Depth

复用 .modal-backdrop 遮罩与 .modal 浮层，延续现有纸面层级。

## Shapes

弹窗圆角 22px，插画圆角 14px；关闭按钮沿用圆形。

## Components

首次弹窗由 app/main.js 的 showSwipeGuide 管理，复用 modal-head、modal-close、primary-button。保留现有 swipeGuideDismissed 存储语义，已关闭的安装不再次展示。确认、关闭、Escape 和遮罩点击均关闭并持久化；Tab 在两个操作间循环并恢复先前焦点。

按钮保留清晰 hover、active 与 focus-visible。首次弹窗不增加动画，中文更新说明使用短句。其他操作和题库内容不因公告改动而改变。

## Do's and Don'ts

- 保持署名、完整图片、更新说明、确认按钮的阅读顺序。
- 将图片随 PWA 构建与离线缓存交付。
- 不因单个弹窗改动重塑全站视觉。
- 不在更新说明里加入技术实现细节。
