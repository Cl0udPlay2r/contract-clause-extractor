# 合成演示样本

这些文件由 `demo/generate_samples.py` 生成，主体、交易、金额及条款均为虚构，仅用于功能演示和测试。

- `service-contract.pdf`：两页完整合同，包含明显需要复核的付款、责任和管辖表述。
- `service-contract-page2.png`：由第二页渲染得到的图片，用于验证 OCR 路径。
- `balanced-contract.pdf`：包含较明确的付款期限、责任上限和仲裁机构。
- `missing-clauses.pdf`：不包含目标三类条款。
- `no-jurisdiction.pdf`：只包含付款和违约责任。
- `unclear-contract.pdf`：付款、责任和争议解决表述均含糊。
- `expected.json`：各 PDF 中人工确认的条款类型，用于小型回归评估。

这些样本不构成法律意见，也不用于评价真实法律场景下的模型准确率。
