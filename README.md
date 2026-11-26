# 析约 · 合同条款提取与风险复核工作台

面向合同初审场景的 Web 工作台：上传 PDF 或图片，提取付款条款、违约责任和争议管辖，把每一条结果落到合同原文的具体页码，用项目内的演示审查规则给出风险提示，并支持人工修改、确认和导出 Excel。

它不判断合同是否合法，也不替代律师。目标是把"律师翻合同、抄条款、填表"的过程变成可以核对和修正的工作台。

> 本仓库中的合同样本、主体、金额和条款全部为合成的演示数据，不含任何真实客户信息。

## 演示

| 状态 | 截图 |
| --- | --- |
| 空状态：上传入口与三栏骨架 | `demo/screenshots/01-empty-state.png` |
| 抽取完成：条款导航、原文高亮、命中规则 | `demo/screenshots/02-clause-review.png` |
| 人工复核：修改摘要后标记"已人工编辑"并确认 | `demo/screenshots/03-edited-confirmed.png` |
| 异常路径：未识别到条款时明确提示复核 | `demo/screenshots/04-missing-clause.png` |

可直接使用的演示文件：

- `demo/samples/service-contract.pdf`：两页合同，付款/责任/管辖三类均有明显需要复核的表述
- `demo/samples/service-contract-page2.png`：由第二页渲染的图片，用于验证 OCR 路径
- `demo/samples/balanced-contract.pdf`：三类条款表述较明确
- `demo/samples/missing-clauses.pdf`：不含任何目标条款
- `demo/samples/no-jurisdiction.pdf`：只有付款和违约责任
- `demo/samples/unclear-contract.pdf`：三类表述均含糊
- `demo/output/service-contract-review.xlsx`：真实导出的复核表格样例

## 核心功能

- 上传 PDF / PNG / JPG / WebP，校验扩展名与文件魔数，限制 12 MB
- 文本 PDF 走 PDF 文本提取；扫描件与图片转交独立的本地 OCR 服务
- 按页保存原文与文本来源，OCR 结果额外保存置信度
- 三类条款的结构化提取：类型、原文、页码、摘要、风险等级、风险说明、复核建议
- 原文溯源：模型返回的摘录必须在提取文本中匹配成功才会标记"已定位"，否则标记"待核对原文"
- 规则辅助风险提示：命中项目内演示规则时展示规则标题、内容和来源
- 人工复核：编辑字段、确认条款、标记误判，状态持久化到数据库
- 未识别到条款时作为正常结果返回，明确提示人工检查，不编造原文
- 导出 Excel：11 列复核表 + 说明页，含页码、定位状态、命中规则和人工状态
- 处理中断、OCR 不可用、模型输出非法、文件损坏都有明确失败状态和重试入口

## 技术栈与结构

```
浏览器 (React 19 + TypeScript + Vite)
        │  /api/documents、/api/clauses/:id
Node 服务 (Express 5，src/server)
   ├── extraction.ts   PDF 文本 / OCR 双路径
   ├── analysis.ts     演示分析器 / OpenAI 兼容模型 + Schema 校验 + 原文匹配
   ├── repository.ts   文档、页、条款、规则的读写
   ├── processor.ts    异步处理状态机
   └── export.ts       ExcelJS 导出
        │
SQLite (node:sqlite)    本地 OCR 服务 (FastAPI + PaddleOCR，ocr-service/)
```

数据库四张表：`documents`（文件与处理状态）、`pages`（按页原文与来源）、`clauses`（结构化结果与人工状态）、`review_rules`（演示审查规则）。

## 关键设计决策

**1. 文本 PDF 与扫描件分开处理。**
所有文件一律 OCR 会降低文本 PDF 的准确率并浪费时间。先用 PDF 文本提取，若有效字符过少才转 OCR；两条路径最终都归一为 `PageRecord[]`，下游无需分支。

**2. 模型输出不等于可信结果。**
模型只负责"找条款"，返回严格 JSON 后由 Zod 校验；摘录还必须与归一化后的原文做匹配才算"已定位"。匹配失败会显示为待复核，而不是当作结论。非法 JSON 重试一次后直接失败，不把错误内容渲染成分析结果。

**3. RAG 检索的是审查规则，不是合同自身。**
把合同切块存向量库再检索回来做提取，对三到五页的合同并不划算。真正需要外部知识的环节是风险提示，因此规则库是显式的、带来源的演示规则，按条款类型过滤后参与判断。规则明确标注为"项目自定义演示规则（非法律意见）"。

**4. 异步处理，但不引入额外基础设施。**
OCR 与模型调用耗时较长，上传后立即返回 `documentId`，前端轮询状态：`uploaded → extracting_text → analyzing → completed / failed`。演示版使用进程内任务执行器，README 和界面都不掩饰这一点。

## 本地启动

```bash
pnpm install
cp .env.example .env      # Windows: copy .env.example .env

pnpm dev                  # 打开两个终端，一个跑 API，一个跑前端
pnpm dev:client           # http://127.0.0.1:5173
```

生产构建与启动：

```bash
pnpm build
pnpm start                # http://127.0.0.1:4000
```

### 分析模式

- `ANALYSIS_PROVIDER=demo`（默认）：使用内置的关键词定位 + 规则分析器，无需任何密钥，便于离线演示与回归测试。
- `ANALYSIS_PROVIDER=openai-compatible`：配置 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 后调用 `/chat/completions` 接口。缺少配置会直接报错，不会静默退回演示分析器。

### OCR 服务（扫描件与图片必需）

```bash
cd ocr-service
python -m venv .venv && .venv\Scripts\activate      # Windows
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 4100
```

未启动时，扫描件会返回明确错误"OCR 服务不可用"，而不是给出空结果。

## 测试与评估

```bash
pnpm test           # 11 个用例：上传校验、OCR 响应、原文匹配、缺失条款、Excel 导出、真实 PDF 集成
pnpm demo:evaluate  # 对照 demo/samples 的人工标注，输出类型召回与原文定位率
```

当前对 5 份合成 PDF 的演示分析器结果：条款类型召回与精确率均为 1，原文定位率 1。这衡量的是内置规则在自建小样本上的表现，**不代表真实模型在真实合同上的准确率**；样本规模不足以支撑任何统计结论。

已知不足：

- 演示分析器依赖中文关键词与正则，遇到条款命名变化会漏提
- 原文匹配按精确子串（忽略空白）比对，模型若改写措辞就无法定位，会落到"待核对原文"
- 高亮按纯文本偏移量渲染，跨页拆分或表格排版时可能失准
- 演示版任务执行器在进程重启后会把未完成任务标记为失败并要求手动重试

## 限制与生产化方向

- 无登录与权限体系，所有文档对访问者可见；真实部署需要账号、租户隔离与对象存储
- 上传文件仅做格式与大小校验，未做病毒扫描；缺少数据保留期、删除策略与加密
- 无持久化任务队列，多实例部署需要换成队列 + 幂等 worker
- 无审计日志与规则版本管理，规则修改不可追溯
- 需要更完整的评测集（含真实脱敏合同）、误提分析与人工复核流程才能谈生产可用

## 目录

```
src/shared     前后端共用类型与枚举
src/server     API、提取、分析、持久化、导出
src/client     三栏复核工作台
tests          单元与集成测试
demo           合成样本、评估脚本、截图、导出样例
ocr-service    独立 OCR 微服务
```

## 声明

本项目仅用于技术演示，输出内容不构成法律意见。所有演示合同均为合成数据，不对应任何真实主体、交易或司法实践。
