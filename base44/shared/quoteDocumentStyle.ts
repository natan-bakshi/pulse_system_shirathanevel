// The stylesheet used by the system's regular quotes, also shared with modular quotes.
export function quoteDocumentStyle(settings = {}, templates = {}) {
  const body = settings.quote_body_font_size || '15';
  const title = settings.quote_title_font_size || '16';
  const line = settings.quote_line_height || '1.6';
  const introSize = templates.introTemplate?.font_size || body;
  const introLine = templates.introTemplate?.line_height || line;
  const summarySize = settings.quote_summary_font_size || body;
  const summaryLine = templates.paymentTemplate?.line_height || settings.quote_summary_line_height || line;
  const detailsSize = settings.quote_event_details_font_size || body;
  const detailsLine = settings.quote_event_details_line_height || line;
  const color = settings.quote_text_color || '#333333';
  const background = settings.quote_background_image || '';
  return `<style>
  @import url('https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;600;700&display=swap');
  *{box-sizing:border-box} @page{size:A4;margin:0}
  body{font-family:'Assistant','Segoe UI','Helvetica Neue',Arial,sans-serif;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:${color};font-size:${body}px;line-height:${line};position:relative;background-color:transparent}
  ${background ? `body::before{content:"";position:fixed;top:0;left:0;width:100%;height:100%;background-image:url('${background}');background-size:cover;background-position:center;background-repeat:no-repeat;z-index:-1;-webkit-print-color-adjust:exact;print-color-adjust:exact}` : 'body{background-color:#ffffff}'}
  .page-content{width:100%;background:transparent;position:relative;z-index:1;padding-left:${settings.quote_margin_left_mm || '20'}mm;padding-right:${settings.quote_margin_right_mm || '20'}mm}
  .date{text-align:left;font-size:calc(${body}px * 0.9);color:#666;margin-bottom:20px;font-weight:600}
  .event-details-box{background-color:transparent;padding:15px;margin-bottom:30px;font-size:${detailsSize}px;line-height:${detailsLine};text-align:center;page-break-inside:avoid}
  .event-details-box *{background-color:transparent!important}
  .section{margin-bottom:40px}
  .section-title{font-size:${title}px;font-weight:700;color:#8B0000;border-bottom:2px solid #DAA520;padding-bottom:10px;margin-top:0;margin-bottom:20px;page-break-after:avoid}
  .category-title{font-size:calc(${title}px * 0.9);font-weight:600;color:#8B0000;padding-bottom:8px;margin:15px 0 10px 0;border-bottom:1px solid #DAA520;page-break-after:avoid}
  .package-group{margin-bottom:40px}
  .package-header{padding-bottom:8px;border-bottom:1px solid #DAA520;margin-bottom:15px;page-break-inside:avoid;page-break-after:avoid}
  .package-title{color:#8B0000;font-size:calc(${title}px * 0.95);font-weight:700;margin:0}
  .package-description{color:#555;font-style:italic;margin-top:6px;font-size:calc(${body}px * 0.95);line-height:1.4}
  .package-content{padding-right:15px}
  .package-service-item{padding:8px 0;border-bottom:1px solid rgba(220,220,220,0.4);display:flex;align-items:flex-start;page-break-inside:avoid}
  .package-service-item:last-child{border-bottom:none}
  .package-service-bullet{color:#DAA520;margin-left:10px;font-size:1em;line-height:1.6}
  .package-footer{margin-top:15px;padding-top:10px;border-top:1px solid #DAA520;display:flex;justify-content:space-between;align-items:center}
  .package-price-label{font-size:${body}px;font-weight:600;color:#444}
  .package-price-container{display:flex;align-items:baseline;gap:8px}
  .package-price-value{font-size:calc(${body}px * 1.2);font-weight:700;color:#8B0000}
  .package-vat-note{font-size:calc(${body}px * 0.8);color:#777}
  .intro-content{text-align:center;margin-bottom:30px;font-size:${introSize}px;line-height:${introLine};color:${color};padding:10px 0}
  .intro-content *, .intro-content p, .intro-content span, .intro-content div, .intro-content li, .intro-content strong, .intro-content b, .intro-content u, .intro-content em, .intro-content a, .intro-content h1, .intro-content h2, .intro-content h3, .intro-content h4, .intro-content h5, .intro-content h6{line-height:${introLine}!important;color:${color}!important;margin-top:0!important;margin-bottom:0!important;background-color:transparent!important}
  .payment-terms{font-size:${summarySize}px;line-height:${summaryLine};color:${color};padding:10px 0}
  .payment-terms *, .payment-terms p, .payment-terms span, .payment-terms div, .payment-terms li, .payment-terms strong, .payment-terms b, .payment-terms u, .payment-terms em, .payment-terms a, .payment-terms h1, .payment-terms h2, .payment-terms h3, .payment-terms h4, .payment-terms h5, .payment-terms h6{line-height:${summaryLine}!important;color:${color}!important;margin-top:0!important;margin-bottom:0!important}
  .event-notes{font-size:${body}px;color:${color};padding:10px 0}
  table{width:100%;border-collapse:collapse;margin-bottom:15px}th,td{padding:8px 10px;text-align:right;vertical-align:top;font-size:${body}px}th{background-color:rgba(248,248,248,0.95);font-weight:600}
  .summary-table td{border-bottom:none;padding:6px 0;font-size:${summarySize}px;line-height:${summaryLine}}
  .summary-table .label{font-weight:600;text-align:right}.summary-table .value{text-align:left;white-space:nowrap}
  .summary-table .total .label,.summary-table .total .value{font-weight:700;font-size:calc(${title}px * 0.9);color:#8B0000;padding-top:10px;border-top:2px solid #8B0000}
  .footer{text-align:center;padding:15px;font-size:calc(${body}px * 0.8);color:#666;border-top:1px solid #eee;margin-top:40px;page-break-inside:avoid}
  </style>`;
}