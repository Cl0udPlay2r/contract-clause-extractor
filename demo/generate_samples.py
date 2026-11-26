from pathlib import Path
import json
import os

import pypdfium2 as pdfium
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'samples'
OUTPUT.mkdir(parents=True, exist_ok=True)

font_path = Path(os.environ.get('DEMO_FONT_PATH', 'C:/Windows/Fonts/simsun.ttc'))
heading_path = Path(os.environ.get('DEMO_HEADING_FONT_PATH', 'C:/Windows/Fonts/simhei.ttf'))
if font_path.exists():
    pdfmetrics.registerFont(TTFont('DemoSerif', str(font_path), subfontIndex=0))
    pdfmetrics.registerFont(TTFont('DemoHeading', str(heading_path if heading_path.exists() else font_path), subfontIndex=0))
else:
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))

body = ParagraphStyle('body', fontName='DemoSerif' if font_path.exists() else 'STSong-Light', fontSize=10.5, leading=20, spaceAfter=8, wordWrap='CJK')
heading = ParagraphStyle('heading', parent=body, fontName='DemoHeading' if font_path.exists() else 'STSong-Light', fontSize=12, leading=22, spaceBefore=8, textColor='#244f5a')
title = ParagraphStyle('title', parent=body, fontName='DemoHeading' if font_path.exists() else 'STSong-Light', fontSize=21, leading=30, alignment=TA_CENTER, spaceAfter=18)
meta = ParagraphStyle('meta', parent=body, textColor='#66767c', alignment=TA_CENTER, fontSize=9)

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('DemoSerif' if font_path.exists() else 'STSong-Light', 8)
    canvas.setFillColor('#7b878c')
    canvas.drawCentredString(A4[0]/2, 10*mm, f'合成演示数据 · 第 {doc.page} 页')
    canvas.restoreState()

contracts = {
    'service-contract': [
        ('第一条 项目内容', '乙方为甲方提供企业内部知识库整理与演示系统建设服务。本合同所有主体、金额和条款均为合成演示内容。'),
        ('第二条 合同金额', '合同总金额为人民币 60,000 元，包含需求梳理、系统开发、测试及交付费用。'),
        ('第三条 验收安排', '甲方应在收到交付成果后组织验收，并一次性提出具体修改意见。'),
        ('第四条 付款方式', '合同签订后，甲方预付合同总额的100%；余款支付时间由双方另行协商。付款前乙方应提供合法有效的收款凭证。'),
        ('第五条 违约责任', '乙方应对任何损失承担全部责任；甲方不承担任何责任。双方未约定赔偿范围或责任上限。'),
        ('第六条 争议解决', '双方可向上海市有管辖权的人民法院或仲裁委员会提出。具体处理方式由一方自行选择。'),
        ('第七条 其他', '本合同自双方盖章之日起生效，未尽事宜由双方另行书面确认。'),
    ],
    'balanced-contract': [
        ('第一条 服务内容', '乙方提供为期三个月的演示咨询服务，双方按书面计划确认交付物。'),
        ('第四条 付款方式', '甲方应在验收通过后 10 个工作日内支付全部服务费，乙方提前提供相应发票。'),
        ('第五条 违约责任', '任何一方违约均应赔偿守约方的直接损失，责任上限为合同总额。'),
        ('第六条 争议解决', '因本合同产生的争议由上海仲裁委员会仲裁。'),
    ],
    'missing-clauses': [
        ('第一条 项目内容', '甲方委托乙方完成一次内部演示资料整理，交付格式由双方通过书面清单确认。'),
        ('第二条 合作期限', '合作期限为一个月，双方应按计划完成资料交接。'),
    ],
    'no-jurisdiction': [
        ('第一条 服务内容', '乙方提供演示系统维护服务，双方按月确认服务记录。'),
        ('第四条 付款方式', '甲方应在每月服务记录确认后 5 个工作日内支付当月服务费。'),
        ('第五条 违约责任', '违约方应赔偿直接损失，赔偿总额不超过已支付服务费。'),
    ],
    'unclear-contract': [
        ('第一条 项目内容', '乙方提供合成演示项目开发服务，具体范围以附件为准。'),
        ('第四条 付款方式', '甲方应在条件成就时适时付款，具体审批流程由甲方内部决定。'),
        ('第五条 违约责任', '乙方承担全部损失，甲方概不负责，双方未约定责任限额。'),
        ('第六条 争议解决', '双方可向相关法院或仲裁机构寻求处理。'),
    ],
}

present = {
    'service-contract': ['payment', 'liability', 'jurisdiction'],
    'balanced-contract': ['payment', 'liability', 'jurisdiction'],
    'missing-clauses': [],
    'no-jurisdiction': ['payment', 'liability'],
    'unclear-contract': ['payment', 'liability', 'jurisdiction'],
}

for name, sections in contracts.items():
    path = OUTPUT / f'{name}.pdf'
    document = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=24*mm, leftMargin=24*mm, topMargin=22*mm, bottomMargin=22*mm, title='合成演示合同', author='合成演示数据')
    story = [Paragraph('企业内部服务合同', title), Paragraph('合成演示数据 · 不对应任何真实主体或交易', meta), Spacer(1, 8*mm), Paragraph('甲方：示例科技有限公司（合成）', body), Paragraph('乙方：演示服务商（合成）', body), Spacer(1, 5*mm)]
    for index, (section_title, content) in enumerate(sections):
        if name == 'service-contract' and index == 3:
            story.append(PageBreak())
        story.extend([Paragraph(section_title, heading), Paragraph(content, body)])
    document.build(story, onFirstPage=footer, onLaterPages=footer)

pdf = pdfium.PdfDocument(str(OUTPUT / 'service-contract.pdf'))
pdf[1].render(scale=1.8).to_pil().save(OUTPUT / 'service-contract-page2.png')
expected = [{'file': f'{name}.pdf', 'present': types} for name, types in present.items()]
(OUTPUT / 'expected.json').write_text(json.dumps(expected, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Generated {len(contracts)} synthetic PDFs and one OCR sample image in {OUTPUT}')
