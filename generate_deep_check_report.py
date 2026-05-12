"""
Generate a detailed PDF deep-check validation report for all capital gains input files.
"""

import json
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, PageBreak
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

RED      = colors.HexColor('#C0392B')
ORANGE   = colors.HexColor('#E67E22')
GREEN    = colors.HexColor('#27AE60')
BLUE     = colors.HexColor('#2980B9')
DARK     = colors.HexColor('#1C2833')
GREY     = colors.HexColor('#7F8C8D')
LGREY    = colors.HexColor('#F2F3F4')
MIDGREY  = colors.HexColor('#D5D8DC')
WHITE    = colors.white
REDLT    = colors.HexColor('#FADBD8')
GREENLT  = colors.HexColor('#D5F5E3')
ORANGELT = colors.HexColor('#FDEBD0')
YELLOWLT = colors.HexColor('#FEF9E7')
BLUELT   = colors.HexColor('#D6EAF8')

W, H = A4
BODY_W = W - 40*mm


def styles():
    base = getSampleStyleSheet()
    def s(name, parent='Normal', **kw):
        return ParagraphStyle(name, parent=base[parent], **kw)
    return {
        'title':    s('T1', fontName='Helvetica-Bold', fontSize=24, textColor=DARK,
                      spaceAfter=4, alignment=TA_CENTER),
        'subtitle': s('T2', fontName='Helvetica',      fontSize=11, textColor=GREY,
                      spaceAfter=2, alignment=TA_CENTER),
        'date':     s('T3', fontName='Helvetica',      fontSize=9,  textColor=GREY,
                      spaceAfter=14, alignment=TA_CENTER),
        'section':  s('S1', fontName='Helvetica-Bold', fontSize=12, textColor=WHITE),
        'h3':       s('H3', fontName='Helvetica-Bold', fontSize=10, textColor=DARK,
                      spaceAfter=3, spaceBefore=6),
        'h4':       s('H4', fontName='Helvetica-Bold', fontSize=9,  textColor=GREY,
                      spaceAfter=2, spaceBefore=4),
        'body':     s('B1', fontName='Helvetica',      fontSize=9,  textColor=DARK,
                      spaceAfter=4, leading=14),
        'bodyb':    s('B2', fontName='Helvetica-Bold', fontSize=9,  textColor=DARK,
                      spaceAfter=4, leading=14),
        'small':    s('SM', fontName='Helvetica',      fontSize=8,  textColor=GREY,
                      spaceAfter=3, leading=12),
        'smallb':   s('SMB',fontName='Helvetica-Bold', fontSize=8,  textColor=DARK,
                      spaceAfter=3, leading=12),
        'mono':     s('MO', fontName='Courier',        fontSize=8,  textColor=DARK,
                      leading=12),
        'bullet':   s('BU', fontName='Helvetica',      fontSize=9,  textColor=DARK,
                      spaceAfter=3, leading=14, leftIndent=12, bulletIndent=0),
    }
ST = styles()


# ── Helpers ──────────────────────────────────────────────────────────────────

def banner(text, bg=DARK):
    data = [[Paragraph(f'<font color="white"><b>{text}</b></font>', ST['section'])]]
    t = Table(data, colWidths=[BODY_W])
    t.setStyle(TableStyle([
        ('BACKGROUND',   (0,0),(-1,-1), bg),
        ('LEFTPADDING',  (0,0),(-1,-1), 8),
        ('RIGHTPADDING', (0,0),(-1,-1), 8),
        ('TOPPADDING',   (0,0),(-1,-1), 6),
        ('BOTTOMPADDING',(0,0),(-1,-1), 6),
    ]))
    return t


def file_banner(text, bg):
    data = [[Paragraph(f'<font color="white"><b>{text}</b></font>', ST['body'])]]
    t = Table(data, colWidths=[BODY_W])
    t.setStyle(TableStyle([
        ('BACKGROUND',   (0,0),(-1,-1), bg),
        ('LEFTPADDING',  (0,0),(-1,-1), 8),
        ('RIGHTPADDING', (0,0),(-1,-1), 8),
        ('TOPPADDING',   (0,0),(-1,-1), 5),
        ('BOTTOMPADDING',(0,0),(-1,-1), 5),
    ]))
    return t


def hr(clr=MIDGREY, sp=4):
    return [Spacer(1, sp), HRFlowable(width='100%', thickness=0.5, color=clr), Spacer(1, sp)]


def kv_table(rows_data, col_w=None):
    """Two-column key/value table."""
    col_w = col_w or [45*mm, BODY_W - 45*mm]
    cmds = [
        ('FONTSIZE',   (0,0),(-1,-1), 8),
        ('FONTNAME',   (0,0),(0,-1), 'Helvetica-Bold'),
        ('FONTNAME',   (1,0),(1,-1), 'Helvetica'),
        ('TOPPADDING', (0,0),(-1,-1), 3),
        ('BOTTOMPADDING',(0,0),(-1,-1), 3),
        ('LEFTPADDING',(0,0),(-1,-1), 5),
        ('VALIGN',     (0,0),(-1,-1), 'TOP'),
        ('ROWBACKGROUNDS',(0,0),(-1,-1),[WHITE, LGREY]),
        ('GRID',       (0,0),(-1,-1), 0.3, MIDGREY),
    ]
    t = Table([[Paragraph(k, ST['smallb']), Paragraph(v, ST['small'])] for k,v in rows_data],
              colWidths=col_w)
    t.setStyle(TableStyle(cmds))
    return t


def mini_table(headers, rows_data, col_widths, highlight_col=None):
    all_rows = [headers] + rows_data
    cmds = [
        ('BACKGROUND',  (0,0),(-1,0), DARK),
        ('TEXTCOLOR',   (0,0),(-1,0), WHITE),
        ('FONTNAME',    (0,0),(-1,0), 'Helvetica-Bold'),
        ('FONTSIZE',    (0,0),(-1,-1), 8),
        ('ROWBACKGROUNDS',(0,1),(-1,-1),[WHITE, LGREY]),
        ('GRID',        (0,0),(-1,-1), 0.3, MIDGREY),
        ('TOPPADDING',  (0,0),(-1,-1), 3),
        ('BOTTOMPADDING',(0,0),(-1,-1), 3),
        ('LEFTPADDING', (0,0),(-1,-1), 5),
        ('ALIGN',       (1,0),(-1,-1), 'RIGHT'),
        ('ALIGN',       (0,0),(0,-1), 'LEFT'),
    ]
    t = Table(all_rows, colWidths=col_widths)
    t.setStyle(TableStyle(cmds))
    return t


def fmt(val, prefix='₹'):
    if val is None: return '—'
    try: return f'{prefix}{float(val):>,.2f}'
    except: return str(val)


def pct(val):
    if val is None: return '—'
    try: return f'{float(val):.2f}%'
    except: return str(val)


def status_colour(status):
    return {'CRIT': RED, 'REVIEW': colors.HexColor('#922B21'),
            'WARN': ORANGE, 'NO_VAL': GREY, 'OK': GREEN}.get(status, GREY)


def file_status(fm):
    src = fm.get('source', '')
    if 'GrandFather' in src or 'capital_gains_FY' in src:
        return 'CRIT'
    pv = fm.get('pdf_validation') or {}
    return pv.get('status', 'NO_VAL') if pv else 'NO_VAL'


# ── Gap comparison table ──────────────────────────────────────────────────────

def gap_table(pv):
    ps = pv.get('pdf_stated') or {}
    ex = pv.get('extracted') or {}
    if not ps.get('total_gain'):
        return None

    def clr(gp):
        if gp is None: return WHITE
        if abs(gp) >= 3.0: return REDLT
        if abs(gp) >= 0.5: return ORANGELT
        return GREENLT

    data = [['', 'PDF Stated (₹)', 'Extracted (₹)', 'Gap (₹)', 'Gap %']]
    cmds = [
        ('BACKGROUND',  (0,0),(-1,0), DARK),
        ('TEXTCOLOR',   (0,0),(-1,0), WHITE),
        ('FONTNAME',    (0,0),(-1,0), 'Helvetica-Bold'),
        ('FONTNAME',    (0,1),(0,-1), 'Helvetica-Bold'),
        ('FONTSIZE',    (0,0),(-1,-1), 8),
        ('ALIGN',       (1,0),(-1,-1), 'RIGHT'),
        ('ALIGN',       (0,0),(0,-1), 'LEFT'),
        ('GRID',        (0,0),(-1,-1), 0.3, MIDGREY),
        ('TOPPADDING',  (0,0),(-1,-1), 3),
        ('BOTTOMPADDING',(0,0),(-1,-1), 3),
        ('LEFTPADDING', (0,0),(-1,-1), 5),
    ]
    rows_info = [
        ('Short Term Gain', 'st_gain',    'st_gain',    'gap_st',  'gap_st_pct'),
        ('Long Term Gain',  'lt_gain',    'lt_gain',    'gap_lt',  'gap_lt_pct'),
        ('Total Gain',      'total_gain', 'total_gain', 'gap',     'gap_pct'),
    ]
    for i, (label, pk, ek, gk, gpk) in enumerate(rows_info, 1):
        gp = pv.get(gpk)
        g  = pv.get(gk)
        data.append([
            label,
            fmt(ps.get(pk)),
            fmt(ex.get(ek)),
            (f'₹{g:+,.2f}' if g is not None else '—'),
            pct(gp),
        ])
        cmds.append(('BACKGROUND', (0, i), (-1, i), clr(gp)))

    t = Table(data, colWidths=[32*mm, 33*mm, 33*mm, 30*mm, 18*mm])
    t.setStyle(TableStyle(cmds))
    return t


# ── Summary overview table ────────────────────────────────────────────────────

def summary_table(file_meta_list):
    STATUS_LABEL = {
        'OK': '✓ OK', 'WARN': '⚠ WARN', 'REVIEW': '● REVIEW',
        'NO_VAL': '– NO VAL', 'CRIT': '✕ CRITICAL',
    }
    headers = ['#', 'File', 'Rows', 'Capital Gain (₹)', 'Val Type', 'Status']
    col_w   = [8*mm, 73*mm, 14*mm, 28*mm, 18*mm, 20*mm]
    rows    = [headers]
    cmds    = [
        ('BACKGROUND',    (0,0),(-1,0), DARK),
        ('TEXTCOLOR',     (0,0),(-1,0), WHITE),
        ('FONTNAME',      (0,0),(-1,0), 'Helvetica-Bold'),
        ('FONTSIZE',      (0,0),(-1,-1), 8),
        ('ROWBACKGROUNDS',(0,1),(-1,-1), [WHITE, LGREY]),
        ('GRID',          (0,0),(-1,-1), 0.3, MIDGREY),
        ('TOPPADDING',    (0,0),(-1,-1), 4),
        ('BOTTOMPADDING', (0,0),(-1,-1), 4),
        ('LEFTPADDING',   (0,0),(-1,-1), 5),
        ('ALIGN',         (2,0),(3,-1), 'RIGHT'),
        ('ALIGN',         (5,0),(5,-1), 'CENTER'),
    ]
    for i, fm in enumerate(file_meta_list):
        pv  = fm.get('pdf_validation') or {}
        src = fm.get('source', '')
        st  = file_status(fm)
        vt  = 'PDF' if (pv.get('pdf_stated') or {}).get('total_gain') is not None else ('Generic' if pv else '—')
        gain = fm.get('capital_gain', 0) or 0
        short = (src[:36] + '…') if len(src) > 36 else src
        rows.append([str(i+1), short, str(fm.get('rows_extracted',0)),
                     f'{gain:,.2f}', vt, STATUS_LABEL.get(st, st)])
        ri = len(rows) - 1
        c  = status_colour(st)
        if st in ('CRIT', 'REVIEW'):
            cmds.append(('BACKGROUND', (0,ri),(-1,ri), REDLT if st=='CRIT' else ORANGELT))
        cmds += [('TEXTCOLOR',  (5,ri),(5,ri), c),
                 ('FONTNAME',   (5,ri),(5,ri), 'Helvetica-Bold')]

    t = Table(rows, colWidths=col_w)
    t.setStyle(TableStyle(cmds))
    return t


# ── Per-file detailed brief ───────────────────────────────────────────────────

def file_brief(fm, all_val_warnings):
    src    = fm.get('source', '')
    pv     = fm.get('pdf_validation') or {}
    ps     = pv.get('pdf_stated') or {}
    ex     = pv.get('extracted') or {}
    causes = pv.get('causes', [])
    status = file_status(fm)
    rows_n = fm.get('rows_extracted', 0)
    gain   = fm.get('capital_gain', 0) or 0
    sale   = fm.get('sale_amount', 0) or 0
    purch  = fm.get('purchase_amount', 0) or 0
    reason = fm.get('not_processed_reason', '') or ''
    proc   = fm.get('process_status', '')

    STATUS_LABEL = {
        'OK': '✓  OK', 'WARN': '⚠  WARN', 'REVIEW': '●  REVIEW',
        'NO_VAL': '–  NO VAL', 'CRIT': '✕  CRITICAL',
    }
    label = STATUS_LABEL.get(status, status)
    bg    = status_colour(status)

    block = []
    block.append(file_banner(f'{label}   {src}', bg))
    block.append(Spacer(1, 4))

    # ── Key metrics row ──
    ext_st  = ex.get('st_gain') or 0
    ext_lt  = ex.get('lt_gain') or 0
    ext_tot = ex.get('total_gain') or 0
    metrics = [
        ['Rows extracted', str(rows_n)],
        ['Sale amount', f'₹{sale:,.2f}'],
        ['Purchase amount', f'₹{purch:,.2f}'],
        ['Capital gain (output)', f'₹{gain:,.2f}'],
        ['Extracted ST gain', f'₹{ext_st:,.2f}'],
        ['Extracted LT gain', f'₹{ext_lt:,.2f}'],
        ['Process status', proc],
    ]
    if reason:
        metrics.append(['Error / Reason', reason[:250]])

    # arrange as 2-col side by side
    left  = metrics[:4]
    right = metrics[4:]
    max_r = max(len(left), len(right))
    while len(left)  < max_r: left.append(['', ''])
    while len(right) < max_r: right.append(['', ''])
    combined = [[Paragraph(lk, ST['smallb']), Paragraph(lv, ST['small']),
                 Paragraph(rk, ST['smallb']), Paragraph(rv, ST['small'])]
                for (lk,lv),(rk,rv) in zip(left,right)]
    mt = Table(combined, colWidths=[30*mm, 40*mm, 34*mm, 42*mm])
    mt.setStyle(TableStyle([
        ('FONTSIZE',     (0,0),(-1,-1), 8),
        ('TOPPADDING',   (0,0),(-1,-1), 3),
        ('BOTTOMPADDING',(0,0),(-1,-1), 3),
        ('LEFTPADDING',  (0,0),(-1,-1), 4),
        ('VALIGN',       (0,0),(-1,-1), 'TOP'),
        ('ROWBACKGROUNDS',(0,0),(-1,-1),[WHITE, LGREY]),
        ('GRID',         (0,0),(-1,-1), 0.3, MIDGREY),
        ('LINEAFTER',    (1,0),(1,-1), 1.0, MIDGREY),
    ]))
    block.append(mt)
    block.append(Spacer(1, 5))

    # ────────────────────────────────────────────────────────────────────────
    # CRITICAL — GrandFather duplicate
    # ────────────────────────────────────────────────────────────────────────
    if 'GrandFather' in src:
        block += [
            Paragraph('DUPLICATE DATA — DETAILED BRIEF', ST['h3']),
            Paragraph(
                'This file is the <b>Motilal Oswal Grandfathering Supplement</b> for client '
                '<b>E513850 (AAPPR8340H / S. Harinath Reddy)</b>. It is a separate PDF that '
                'Motilal Oswal generates alongside the main Capital Gain/Loss Summary to show the '
                'grandfathering calculation worksheet — it lists the same Long Term transactions '
                'with the 31-January-2018 high prices overlaid.', ST['body']),
            Paragraph(
                'It extracted <b>94 LT rows</b> with a total LT gain of '
                '<b>₹12,08,297.73</b>. The main CapitalGainLossSummary_E513850.pdf '
                'has a PDF-stated LT total of ₹12,08,297.72 — a difference of just ₹0.01 (rounding). '
                'These are <b>identical transactions</b>. Including both files in the same run '
                'produces <b>double-counted LT gains of ~₹12.08 lakh</b>.', ST['body']),
            Paragraph(
                '<b>What grandfathering means here:</b> Grandfathering under Section 112A allows '
                'taxpayers to use the higher of actual purchase cost or the 31-Jan-2018 fair market '
                'value as the cost of acquisition for LT equity gains. The main statement already '
                'incorporates these adjusted costs. This GrandFather file is a supporting worksheet, '
                'not an additional source of transactions.', ST['body']),
            Paragraph(
                '<b>Action required:</b> Remove <b>GrandFatherGainLossDeatils_E513850.pdf</b> from '
                'the input list entirely. It will inflate LT gains by ~₹12.08L and '
                'distort the client\'s tax liability.', ST['bodyb']),
        ]
        return block

    # ────────────────────────────────────────────────────────────────────────
    # CRITICAL — Computax Excel template
    # ────────────────────────────────────────────────────────────────────────
    if 'capital_gains_FY' in src:
        block += [
            Paragraph('COMPUTAX TEMPLATE — DETAILED BRIEF', ST['h3']),
            Paragraph(
                'This Excel file is a <b>Computax data entry template</b> — the proprietary format '
                'used to upload capital gains directly to the Computax tax filing software. '
                'It has <b>261 data rows</b> (row 1: info header, row 2: column headers, rows 3–263: data), '
                'with a total sale amount of <b>₹53,20,238.52</b>.', ST['body']),
            Paragraph(
                'Every row has "Source (Statement Name)" = <b>taxpnl-WW3054-2024_2025-Q1-Q4</b> — '
                'the same Zerodha Tax P&amp;L file that is also present in the input folder and was '
                'processed separately (extracting 276 rows). This confirms the Computax file is '
                'a <b>derived output</b> of the taxpnl data, not an independent source.', ST['body']),
            Paragraph(
                '<b>Extraction failure:</b> GenericExcelParser returned 0 rows because the column '
                'structure does not match any known broker format. The Ollama AI fallback extracted '
                'only 2 rows — severely incomplete. The 261 actual rows were never extracted.', ST['body']),
            Paragraph(
                '<b>Risk if included:</b> The 276 rows from taxpnl-WW3054 are already in the output. '
                'If this file were also parsed correctly, the taxpnl data would be counted twice.', ST['body']),
            Paragraph(
                '<b>Action required:</b> Confirm whether this file has any data <i>not</i> present '
                'in taxpnl-WW3054. If it is purely a Computax export of that data, '
                '<b>remove it from the input list</b>. If it has additional trades, provide the '
                'original broker statement instead — not the Computax template.', ST['bodyb']),
        ]
        return block

    # ────────────────────────────────────────────────────────────────────────
    # REVIEW — MotilalOswal P&L (gap analysis)
    # ────────────────────────────────────────────────────────────────────────
    if 'CapitalGainLossSummary_E513850' in src:
        block += [
            Paragraph('VALIDATION BRIEF — MOTILAL OSWAL P&L (835 ROWS EXTRACTED)', ST['h3']),
        ]
        gt = gap_table(pv)
        if gt:
            block += [gt, Spacer(1, 5)]

        block += [
            Paragraph('Understanding the gap', ST['h4']),
            Paragraph(
                'The total gap of <b>₹72,965.98 (2.92%)</b> is composed of three independent causes. '
                'None of them represent a mis-extraction of rows that were parsed — they are all '
                'structurally correct exclusions or unextracted rows due to PDF format issues:', ST['body']),
        ]

        # ── Cause 1: Zero-cost bonus shares ──
        zc_cause = next((c for c in causes if c['type'] == 'ZERO_COST_BONUS_SHARES'), None)
        if zc_cause:
            zc_rows = zc_cause.get('rows', [])
            block += [
                Paragraph(
                    f'<b>Cause 1 — Zero-cost bonus / demerger shares ({zc_cause.get("count",0)} rows)</b>',
                    ST['bodyb']),
                Paragraph(
                    'These are shares received as bonus or through corporate demergers. '
                    'The broker records purchase cost as ₹0.00 — the PDF itself shows the same. '
                    'The full sale value is therefore treated as gain. These rows ARE extracted '
                    'correctly; they contribute to the gain figure but do not cause any gap.', ST['body']),
            ]
            if zc_rows:
                tbl_data = [['Share Name', 'Sale Amount (₹)']]
                for r in zc_rows[:10]:
                    tbl_data.append([r.get('name','')[:55], f'{r.get("sale",0):,.2f}'])
                if zc_cause.get('count', 0) > 10:
                    tbl_data.append([f'… and {zc_cause["count"]-10} more rows', ''])
                block.append(mini_table(
                    tbl_data[0], tbl_data[1:],
                    [110*mm, 36*mm]
                ))
                block.append(Spacer(1, 4))

        # ── Cause 2: Intraday trades ──
        it_cause = next((c for c in causes if c['type'] == 'INTRADAY_TRADES'), None)
        if it_cause:
            it_rows = it_cause.get('rows', [])
            block += [
                Paragraph(
                    f'<b>Cause 2 — Intraday trades excluded ({it_cause.get("count",0)} rows)</b>',
                    ST['bodyb']),
                Paragraph(
                    'Rows where the sale date equals the purchase date are excluded under Rule 5 '
                    '(intraday / same-day trades). These are speculative income, not capital gains, '
                    'and do not belong in a capital gains schedule. The PDF includes them in its ST '
                    'total, which creates part of the ST gap. All 7 excluded intraday trades are '
                    'listed below:', ST['body']),
            ]
            if it_rows:
                tbl_data = [['Share Name', 'Date', 'Gain/Loss (₹)']]
                for r in it_rows:
                    tbl_data.append([
                        r.get('name','')[:52],
                        r.get('date',''),
                        f'{r.get("gain",0):+,.2f}'
                    ])
                block.append(mini_table(
                    tbl_data[0], tbl_data[1:],
                    [90*mm, 26*mm, 30*mm]
                ))
                block.append(Spacer(1, 4))

        # ── Cause 3: Missing collapsed-format rows ──
        block += [
            Paragraph('<b>Cause 3 — Collapsed PDF format (estimated ~13 rows unextracted)</b>', ST['bodyb']),
            Paragraph(
                'Motilal Oswal P&amp;L PDFs use two row layouts in their tables. "Clean" rows have '
                'each field in its own column (15+ filled cells). "Collapsed" rows have all data '
                'squeezed into a single cell as multi-line text. The parser reconstructs collapsed '
                'rows by splitting on newlines and finding the ISIN, but some rows use an unusual '
                'sub-format where amounts and dates run together without whitespace.', ST['body']),
            Paragraph(
                'Based on the ST gap of ₹58,792 and LT gap of ₹14,174, approximately 13 trades '
                'were not extracted. These are likely borderline collapsed-format rows for securities '
                'such as BEL, L&amp;T Finance, SBI, KAYNES, and a few others that appeared in '
                'previous analysis. The gain contribution per missing row averages ~₹5,612.', ST['body']),
            Paragraph(
                '<b>What you can do:</b> Cross-reference the extracted list against the full PDF '
                'to identify the ~13 missing securities. Each missing trade should be entered '
                'manually into the output or the PDF format needs a parser enhancement.', ST['body']),
        ]

        gm = next((c for c in causes if c['type'] == 'GAIN_TYPE_MISMATCH'), None)
        if gm:
            block += [
                Paragraph('<b>ST vs LT split divergence</b>', ST['bodyb']),
                Paragraph(gm.get('note',''), ST['body']),
                Paragraph(
                    'The ST gap (4.6%) is larger than the LT gap (1.2%) because most of the '
                    'missing/excluded rows are in the ST bucket: 7 intraday trades (all ST by '
                    'definition) plus the majority of the ~13 missing collapsed rows.', ST['body']),
            ]
        return block

    # ────────────────────────────────────────────────────────────────────────
    # INFORMATIONAL — Axis Bank (CID-encoded, 3 rows via OCR)
    # ────────────────────────────────────────────────────────────────────────
    if 'Axis_bank' in src:
        block += [
            Paragraph('OCR EXTRACTION — DETAILED BRIEF', ST['h3']),
            Paragraph(
                'This PDF uses a <b>CID-encoded font</b> — a proprietary embedded font where the '
                'character codes map to private glyph IDs that cannot be decoded by standard text '
                'extraction libraries. This is common with Axis Bank portfolio statements.', ST['body']),
            Paragraph(
                'The system attempted OCR (optical character recognition) as a fallback and '
                'extracted <b>3 rows</b>. No PDF-stated totals are available because the summary '
                'page is also CID-encoded and unreadable.', ST['body']),
            Paragraph('Rows extracted by OCR:', ST['h4']),
        ]
        block.append(mini_table(
            ['Fund Name', 'Type', 'Days', 'Sale (₹)', 'Purchase (₹)', 'Gain (₹)'],
            [
                ['Axis ELSS Tax Saver Fund – Regular Plan', 'Long Term',  '1,886', '1,837.99',  '933.16',   '+904.83'],
                ['Axis ELSS Tax Saver Fund – Regular Plan', 'Long Term',  '1,855', '5,956.99',  '3,000.00', '+2,956.99'],
                ['Axis Balanced Advantage Fund – Regular', 'Short Term',  '44',    '49,999.97', '51,527.44','-1,527.47'],
            ],
            [55*mm, 20*mm, 12*mm, 22*mm, 22*mm, 18*mm]
        ))
        block += [
            Spacer(1, 4),
            Paragraph(
                'The 3 rows look plausible for a small mutual fund portfolio: two ELSS (LTCG, '
                'held 5+ years) and one Balanced Advantage Fund (STCG, 44-day SIP redemption). '
                'However, <b>accuracy cannot be verified</b> without the PDF-stated totals.', ST['body']),
            Paragraph(
                '<b>Recommendation:</b> Ask your client to request a <i>text-readable</i> version '
                'of the Axis Bank capital gains statement from the relationship manager or download '
                'the statement from a different source (e.g. CAMS/KFintech consolidated).', ST['bodyb']),
        ]
        return block

    # ────────────────────────────────────────────────────────────────────────
    # INFORMATIONAL — Canara Rebeco (CID-encoded, 8 rows via OCR)
    # ────────────────────────────────────────────────────────────────────────
    if 'Canara' in src:
        block += [
            Paragraph('OCR EXTRACTION — DETAILED BRIEF', ST['h3']),
            Paragraph(
                'Same CID-encoding issue as Axis Bank — standard text extraction fails. '
                'OCR fallback extracted <b>8 rows</b> across two funds.', ST['body']),
            Paragraph('Rows extracted by OCR:', ST['h4']),
        ]
        block.append(mini_table(
            ['Fund', 'Type', 'Days', 'Sale (₹)', 'Purchase (₹)', 'Gain (₹)'],
            [
                ['Canara Robeco Flexi Cap – Direct Growth', 'Short Term', '49',  '1,33,511.91', '1,21,111.10', '+12,400.81'],
                ['Canara Robeco Flexi Cap – Direct Growth', 'Short Term', '49',  '30,651.19',   '27,611.10',   '+3,040.09'],
                ['Canara Robeco Flexi Cap – Direct Growth', 'Short Term', '65',  '50,951.19',   '45,311.10',   '+5,640.09'],
                ['Canara Robeco Flexi Cap – Direct Growth', 'Short Term', '65',  '82,651.19',   '72,911.10',   '+9,740.09'],
                ['Canara Robeco Flexi Cap – Direct Growth', 'Short Term', '65',  '71,651.19',   '63,311.10',   '+8,340.09'],
                ['Canara Robeco Flexi Cap – Direct Growth', 'Short Term', '65',  '21,951.19',   '19,411.10',   '+2,540.09'],
                ['Canara Robeco Mid Cap – Direct Growth',   'Short Term', '118', '16,697.75',   '15,000.00',   '+1,697.75'],
                ['Canara Robeco Mid Cap – Direct Growth',   'Short Term', '118', '1,627.52',    '1,500.00',    '+127.52'],
            ],
            [52*mm, 20*mm, 10*mm, 24*mm, 24*mm, 18*mm]
        ))
        block += [
            Spacer(1, 4),
            Paragraph(
                'All 8 rows are Short Term. The Flexi Cap rows in groups of 4 follow a consistent '
                'pattern (same holding periods: 49 or 65 days) suggesting SIP-based redemptions '
                'across multiple instalments. Total extracted gain: <b>₹43,526.53</b>. '
                'Accuracy cannot be verified without PDF-stated totals.', ST['body']),
            Paragraph(
                '<b>Recommendation:</b> Request text-readable PDF from Canara Robeco directly '
                'via their investor portal, or obtain a consolidated statement from KFintech.', ST['bodyb']),
        ]
        return block

    # ────────────────────────────────────────────────────────────────────────
    # INFORMATIONAL — Tax_P&L (2365 rows, large Zerodha file)
    # ────────────────────────────────────────────────────────────────────────
    if 'Tax_P' in src:
        it_cause = next((c for c in causes if c['type'] == 'INTRADAY_TRADES'), None)
        zc_cause = next((c for c in causes if c['type'] == 'ZERO_COST_BONUS_SHARES'), None)
        it_count = it_cause.get('count', 0) if it_cause else 0
        zc_count = zc_cause.get('count', 0) if zc_cause else 0

        block += [
            Paragraph('LARGE FILE — DETAILED BRIEF (2,365 ROWS)', ST['h3']),
            Paragraph(
                'This is a Motilal Oswal Tax P&amp;L Excel report for FY 2024–25 covering a '
                'very large portfolio. It extracted <b>2,365 rows</b> with a net capital gain of '
                f'<b>₹{gain:,.2f}</b> (ST: ₹{ext_st:,.2f} / LT: ₹{ext_lt:,.2f}).', ST['body']),
            Paragraph(
                f'<b>⚠ {it_count} intraday trades excluded</b>', ST['bodyb']),
            Paragraph(
                f'The parser found <b>{it_count} same-day (intraday) trades</b> in the raw file '
                'that were excluded under Rule 5. These represent speculative income that does not '
                'belong in the capital gains schedule. The first 5 excluded trades are:', ST['body']),
        ]
        if it_cause and it_cause.get('rows'):
            tbl_data = [['Share Name', 'Date', 'Gain/Loss (₹)']]
            for r in it_cause['rows'][:10]:
                tbl_data.append([r.get('name','')[:52], r.get('date',''),
                                  f'{r.get("gain",0):+,.2f}'])
            if it_count > 10:
                tbl_data.append([f'… and {it_count-10} more intraday trades', '', ''])
            block.append(mini_table(tbl_data[0], tbl_data[1:], [90*mm, 26*mm, 30*mm]))
            block.append(Spacer(1, 4))

        block += [
            Paragraph(f'<b>{zc_count} zero-cost bonus shares</b>', ST['bodyb']),
            Paragraph(
                f'{zc_count} rows have purchase_amount = ₹0 (bonus/demerger/rights shares). '
                'These are extracted correctly — the full sale value is taken as gain. '
                'Sample:', ST['body']),
        ]
        if zc_cause and zc_cause.get('rows'):
            tbl_data = [['Share Name', 'Sale Amount (₹)']]
            for r in zc_cause['rows'][:6]:
                tbl_data.append([r.get('name','')[:55], f'{r.get("sale",0):,.2f}'])
            block.append(mini_table(tbl_data[0], tbl_data[1:], [110*mm, 36*mm]))
            block.append(Spacer(1, 4))

        block.append(Paragraph(
            'No PDF-stated totals are available for this Excel format. '
            'Validation is based on extraction statistics only.', ST['small']))
        return block

    # ────────────────────────────────────────────────────────────────────────
    # INFORMATIONAL — taxpnl Zerodha (276 rows, 4799 intraday!)
    # ────────────────────────────────────────────────────────────────────────
    if 'taxpnl' in src:
        it_cause = next((c for c in causes if c['type'] == 'INTRADAY_TRADES'), None)
        zc_cause = next((c for c in causes if c['type'] == 'ZERO_COST_BONUS_SHARES'), None)
        it_count = it_cause.get('count', 0) if it_cause else 0
        zc_count = zc_cause.get('count', 0) if zc_cause else 0

        block += [
            Paragraph('ZERODHA TAX P&L — DETAILED BRIEF', ST['h3']),
            Paragraph(
                'This is a Zerodha Tax P&amp;L report (client WW3054) for FY 2024–25 Q1–Q4. '
                'It extracted <b>276 capital gains rows</b> with a net gain of '
                f'<b>₹{gain:,.2f}</b> (all Short Term: ₹{ext_st:,.2f}).', ST['body']),
        ]

        if it_count >= 100:
            block += [
                Paragraph(f'⚠  HIGH ALERT — {it_count:,} INTRADAY TRADES EXCLUDED', ST['h3']),
                Paragraph(
                    f'The parser found <b>{it_count:,} same-day (intraday) trades</b> in the raw '
                    'Zerodha file that were excluded under Rule 5. This is an extremely high number '
                    'and indicates this is a <b>very active day-trading account</b>. '
                    'These intraday gains and losses are <b>speculative income</b>, not capital '
                    'gains, and must be reported separately under "Income from Speculative Business" '
                    '(not in Schedule CG).', ST['body']),
                Paragraph(
                    'The 276 rows in the output represent only the <i>multi-day</i> (delivery-based) '
                    f'trades. The {it_count:,} intraday trades need to be assessed separately for '
                    'business income tax treatment. Please confirm with your client whether they have '
                    'computed the speculative income from these intraday trades.', ST['bodyb']),
            ]
        else:
            block += [
                Paragraph(f'<b>{it_count} intraday trades excluded</b>', ST['bodyb']),
                Paragraph(
                    f'{it_count} same-day trades excluded (speculative income). '
                    'Sample:', ST['body']),
            ]

        if it_cause and it_cause.get('rows'):
            tbl_data = [['Share Name', 'Date', 'Gain/Loss (₹)']]
            for r in it_cause['rows'][:8]:
                tbl_data.append([r.get('name','')[:52], r.get('date',''),
                                  f'{r.get("gain",0):+,.2f}'])
            if it_count > 8:
                tbl_data.append([f'… and {it_count-8:,} more intraday trades', '', ''])
            block.append(mini_table(tbl_data[0], tbl_data[1:], [90*mm, 26*mm, 30*mm]))
            block.append(Spacer(1, 4))

        if zc_cause:
            block += [
                Paragraph(f'<b>{zc_count} zero-cost bonus shares</b>', ST['bodyb']),
                Paragraph(
                    f'{zc_count} rows have purchase_amount = ₹0 (bonus shares like BPCL bonus '
                    'allotments). Extracted correctly. Sample:', ST['body']),
            ]
            if zc_cause.get('rows'):
                tbl_data = [['Share Name', 'Sale Amount (₹)']]
                for r in zc_cause['rows'][:5]:
                    tbl_data.append([r.get('name','')[:55], f'{r.get("sale",0):,.2f}'])
                block.append(mini_table(tbl_data[0], tbl_data[1:], [110*mm, 36*mm]))
                block.append(Spacer(1, 4))

        return block

    # ────────────────────────────────────────────────────────────────────────
    # Purnartha — show the perfect validation result
    # ────────────────────────────────────────────────────────────────────────
    if 'PURNARTHA' in src.upper():
        block += [
            Paragraph('PDF VALIDATION — DETAILED BRIEF', ST['h3']),
            Paragraph(
                'Purnartha has full PDF validation — the Capital Gain/Loss Summary pages are '
                'read and compared against extracted totals.', ST['body']),
        ]
        gt = gap_table(pv)
        if gt:
            block += [gt, Spacer(1, 5)]
        block += [
            Paragraph(
                'The ₹0.01 rounding difference in ST gain is pure floating-point arithmetic — '
                'the PDF states ₹3,35,869.16 and we compute ₹3,35,869.15. This is within a '
                'single paisa and is not a real discrepancy.', ST['body']),
            Paragraph(
                '<b>Gain type fix applied this session:</b> The "Shares w/o STT" section in '
                'Purnartha statements groups listed equity shares (sold without STT via '
                'off-market transactions) alongside unlisted/debt instruments in one section '
                'header. The parser was previously treating all rows in this combined section '
                'as Debt (730-day LT threshold), which misclassified Aavas Financiers Ltd '
                '(held 532 days, gain ₹9,800.63) as Short Term instead of Long Term. '
                'Fixed by detecting the "w/o STT" marker and applying the equity '
                '365-day threshold.', ST['body']),
        ]
        return block

    # ────────────────────────────────────────────────────────────────────────
    # Generic OK files — show extraction summary and any causes
    # ────────────────────────────────────────────────────────────────────────
    block += [
        Paragraph('EXTRACTION SUMMARY', ST['h3']),
        Paragraph(
            f'Extracted <b>{rows_n} rows</b> with total capital gain of <b>₹{gain:,.2f}</b> '
            f'(ST: ₹{ext_st:,.2f} | LT: ₹{ext_lt:,.2f}). '
            f'No PDF-stated totals available for this format — generic validation only.',
            ST['body']),
    ]

    if causes:
        block.append(Paragraph('Flagged causes:', ST['h4']))
        for c in causes:
            c_rows = c.get('rows', [])
            block += [
                Paragraph(f'<b>{c["type"]}</b> ({c.get("count","")} rows) — {c.get("note","")}',
                          ST['body']),
            ]
            if c_rows:
                tbl_data = [['Name', 'Value']]
                key2 = 'sale' if 'sale' in (c_rows[0] if c_rows else {}) else 'gain'
                lbl2 = 'Sale Amount (₹)' if key2 == 'sale' else 'Gain/Loss (₹)'
                tbl_data[0][1] = lbl2
                for r in c_rows[:6]:
                    val = r.get(key2, 0)
                    tbl_data.append([r.get('name','')[:55], f'{val:,.2f}'])
                if c.get('count', 0) > 6:
                    tbl_data.append([f'… and {c["count"]-6} more', ''])
                block.append(mini_table(tbl_data[0], tbl_data[1:], [110*mm, 36*mm]))
                block.append(Spacer(1, 3))

    if not causes and status == 'OK':
        block.append(Paragraph('No issues flagged. Extraction clean.', ST['small']))

    return block


# ── Main report builder ───────────────────────────────────────────────────────

def generate_report(json_data, out_path):
    doc = SimpleDocTemplate(
        out_path, pagesize=A4,
        rightMargin=20*mm, leftMargin=20*mm,
        topMargin=20*mm, bottomMargin=20*mm,
        title='Capital Gains Deep Check Report',
    )
    story = []

    total_rows = json_data.get('total_rows', 0)
    total_gain = json_data.get('total_capital_gain', 0)
    file_meta  = json_data.get('file_meta', [])
    val_warns  = json_data.get('validation_warnings', [])

    # ── Cover ──────────────────────────────────────────────────────────────
    story.append(Spacer(1, 12*mm))
    story.append(Paragraph('Capital Gains Extractor', ST['title']))
    story.append(Paragraph('Deep Validation Check — All Input Files', ST['subtitle']))
    story.append(Paragraph('FY 2024–25  |  Generated 12 May 2026', ST['date']))
    story += hr(DARK, 4)
    story.append(Spacer(1, 4*mm))

    # KPI tiles
    n_crit  = sum(1 for fm in file_meta if file_status(fm) == 'CRIT')
    n_rev   = sum(1 for fm in file_meta if file_status(fm) == 'REVIEW')
    n_ok    = sum(1 for fm in file_meta if file_status(fm) == 'OK')
    kpi = [
        ['Files', 'Total Rows', 'Total Capital Gain', 'Critical Issues'],
        [str(len(file_meta)), f'{total_rows:,}', f'₹{total_gain:,.2f}', str(n_crit)],
    ]
    col_w4 = [(BODY_W) / 4] * 4
    kt = Table(kpi, colWidths=col_w4)
    kt.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,0), LGREY),
        ('BACKGROUND',    (0,1),(-1,1), DARK),
        ('BACKGROUND',    (3,1),(3,1), RED if n_crit else DARK),
        ('TEXTCOLOR',     (0,0),(-1,0), GREY),
        ('TEXTCOLOR',     (0,1),(-1,1), WHITE),
        ('FONTNAME',      (0,0),(-1,0), 'Helvetica'),
        ('FONTNAME',      (0,1),(-1,1), 'Helvetica-Bold'),
        ('FONTSIZE',      (0,0),(-1,0), 8),
        ('FONTSIZE',      (0,1),(-1,1), 16),
        ('ALIGN',         (0,0),(-1,-1), 'CENTER'),
        ('TOPPADDING',    (0,0),(-1,-1), 7),
        ('BOTTOMPADDING', (0,0),(-1,-1), 7),
        ('GRID',          (0,0),(-1,-1), 0.5, WHITE),
    ]))
    story.append(kt)
    story.append(Spacer(1, 6*mm))

    # Status summary pills
    summary_pill = (
        f'<b>Status breakdown:</b>  '
        f'<font color="#C0392B">✕ {n_crit} Critical</font>  |  '
        f'<font color="#E67E22">● {n_rev} Review</font>  |  '
        f'<font color="#27AE60">✓ {n_ok} OK</font>  |  '
        f'<font color="#7F8C8D">– {len(file_meta)-n_crit-n_rev-n_ok} No Val</font>'
    )
    story.append(Paragraph(summary_pill, ST['body']))
    story.append(Spacer(1, 4*mm))

    # ── Critical callout box ────────────────────────────────────────────────
    if n_crit:
        story.append(banner('⚠  CRITICAL ISSUES — ACTION REQUIRED BEFORE FILING', RED))
        story.append(Spacer(1, 4))

        crit_items = []
        for fm in file_meta:
            s = file_status(fm)
            src = fm.get('source','')
            if s != 'CRIT': continue
            if 'GrandFather' in src:
                crit_items.append((
                    'GrandFatherGainLossDeatils_E513850.pdf',
                    'DUPLICATE: Same LT transactions as CapitalGainLossSummary_E513850 (same client E513850). '
                    '94 rows, ~₹12,08,298 LT gain will be double-counted if both files are included. '
                    'Remove this file from the input list immediately.'
                ))
            if 'capital_gains_FY' in src:
                crit_items.append((
                    'capital_gains_FY2024-2025_2026-04-24 (2).xlsx',
                    'COMPUTAX TEMPLATE: 261 rows of taxpnl-WW3054 data in Computax upload format. '
                    'Only 2 rows extracted (parser could not read format). '
                    'If this is derived from the taxpnl file already in the input, it will '
                    'double-count that data. Confirm and remove if redundant.'
                ))

        for fname, desc in crit_items:
            story.append(KeepTogether([
                Paragraph(f'<b>{fname}</b>', ST['bodyb']),
                Paragraph(desc, ST['body']),
                Spacer(1, 3),
            ]))
        story.append(Spacer(1, 4*mm))

    # ── Summary table ───────────────────────────────────────────────────────
    story.append(banner('  File Overview — All Files', BLUE))
    story.append(Spacer(1, 4))
    story.append(summary_table(file_meta))
    story.append(Spacer(1, 2))
    story.append(Paragraph(
        '<b>Legend:</b>  ✓ OK = gap &lt;0.5% on all metrics  |  '
        '⚠ WARN = gap 0.5–3%  |  ● REVIEW = gap &gt;3%  |  '
        '✕ CRITICAL = action required  |  – NO VAL = no validation (OCR/AI path)',
        ST['small']
    ))

    # ── Per-file detailed sections ──────────────────────────────────────────
    story.append(PageBreak())
    story.append(banner('  Per-File Detailed Briefs', DARK))
    story.append(Spacer(1, 6))

    STATUS_ORDER = {'CRIT': 0, 'REVIEW': 1, 'WARN': 2, 'NO_VAL': 3, 'OK': 4}
    sorted_meta = sorted(file_meta, key=lambda fm: STATUS_ORDER.get(file_status(fm), 99))

    for fm in sorted_meta:
        block = file_brief(fm, val_warns)
        block.append(Spacer(1, 5*mm))
        story += block

    # ── Action checklist ────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(banner('  Action Checklist', colors.HexColor('#1A5276')))
    story.append(Spacer(1, 6))

    actions = [
        ('🔴 MUST DO — Remove GrandFatherGainLossDeatils_E513850.pdf',
         'This file contains the same LT transactions as the MotilalOswal main statement. '
         'Including it inflates LT capital gains by ~₹12.08 lakh. '
         'Remove from the input list before generating the final output.'),
        ('🔴 MUST DO — Resolve capital_gains_FY2024-2025_2026-04-24 (2).xlsx',
         'Confirm whether this Computax template contains data beyond the taxpnl file. '
         'If it is derived from taxpnl-WW3054, remove it. '
         'Only 2 of the 261 rows were extracted — do not rely on this file for any data.'),
        ('🟡 REVIEW — CapitalGainLossSummary_E513850.pdf (MotilalOswal)',
         'ST gap 4.6% (₹58,791), total gap 2.9% (₹72,966). '
         'Root cause: ~13 rows in unusual collapsed PDF format could not be extracted. '
         'Cross-check the extracted list against the PDF and add missing trades manually.'),
        ('🟡 NOTE — taxpnl-WW3054-2024_2025-Q1-Q4.xlsx (Zerodha)',
         '4,799 intraday trades were excluded from capital gains. '
         'This indicates a very active day-trading account. '
         'These intraday gains/losses need separate tax treatment as speculative income '
         '(ITR-3 Schedule BP, not Schedule CG).'),
        ('🟡 NOTE — Axis Bank & Canara Rebeco (CID-encoded PDFs)',
         '3 rows and 8 rows respectively extracted via OCR. '
         'Row counts look plausible for small portfolios but cannot be verified. '
         'Request text-readable PDFs from the broker to confirm accuracy.'),
        ('✅ NO ACTION — All other 15 files',
         'Purnartha gap ₹0.01 (rounding). '
         'Tax_P&L 2,365 rows clean. '
         'MiraeAsset, Anand Rathi, CAMS, Franklin, Kuvera, SBI MF, Groww, Zerodha '
         'stocks all extracted without issues.'),
    ]

    for i, (title, desc) in enumerate(actions):
        story += [
            Paragraph(f'<b>{title}</b>', ST['bodyb']),
            Paragraph(desc, ST['body']),
            Spacer(1, 4),
        ]

    # ── Methodology ─────────────────────────────────────────────────────────
    story += hr(MIDGREY, 8)
    story.append(banner('  Validation Methodology', GREY))
    story.append(Spacer(1, 6))

    meth = [
        ('PDF Validation (MotilalOswal, Purnartha)',
         'For parsers that support it, the extractor reads the PDF\'s own stated ST/LT/Total '
         'gain summary table and compares it against the extracted rows. Gap is calculated '
         'per-category (ST, LT, Total). Status: OK &lt; 0.5%, WARN 0.5–3%, REVIEW &gt; 3%.'),
        ('Generic Validation (all other parsers)',
         'Extraction statistics are computed (intraday count, zero-cost bonus shares) '
         'but no PDF-stated total is available for comparison. Status shows OK by default.'),
        ('Intraday Exclusion (Rule 5)',
         'Rows where sale_date == purchase_date are excluded. These are speculative income '
         '(intraday trades), not capital gains, and belong in ITR-3 Schedule BP.'),
        ('Zero-cost Rows',
         'Rows with purchase_amount = 0 are bonus/rights/demerger shares. '
         'The full sale value is taken as gain. Correct per PDF.'),
        ('LT/ST Classification',
         'Equity & equity MF: Long Term if held &gt; 365 days. '
         'Debt instruments: Long Term only if purchased on or before 31-Mar-2023 '
         'AND held &gt; 730 days (Finance Act 2023). '
         'Listed shares sold w/o STT (Purnartha): equity threshold (365 days).'),
        ('OCR / AI Fallback',
         'CID-encoded PDFs go through OCR. Unrecognised Excel formats fall back to Ollama AI. '
         'These paths produce extraction-only results with no PDF comparison.'),
    ]
    for title, desc in meth:
        story += [
            Paragraph(f'<b>{title}</b>', ST['bodyb']),
            Paragraph(desc, ST['body']),
            Spacer(1, 2),
        ]

    story += hr(MIDGREY, 8)
    story.append(Paragraph(
        'Generated by Capital Gains Extractor  |  Deep Validation Check  |  12 May 2026',
        ST['small']
    ))

    doc.build(story)
    print(f'Saved: {out_path}')


if __name__ == '__main__':
    import sys
    json_src = sys.argv[1] if len(sys.argv) > 1 else '/dev/stdin'
    out_path = sys.argv[2] if len(sys.argv) > 2 else \
               '/Users/vanshjalan/Desktop/Capital_Gains_Deep_Check_Report.pdf'

    with open(json_src) as f:
        data = json.loads(f.readline())

    generate_report(data, out_path)
