export type DemoLanguage = 'en' | 'ar';

/** Arabic UI labels kept in the demo boundary; document bidi remains model-driven. */
export const ARABIC_LABELS = Object.freeze({
  appTitle: 'محرر المستندات',
  file: 'ملف',
  edit: 'تحرير',
  view: 'عرض',
  insert: 'إدراج',
  format: 'تنسيق',
  tools: 'أدوات',
  open: 'فتح',
  download: 'تنزيل',
  details: 'تفاصيل المستند',
  assistant: 'المساعد الذكي',
  send: 'إرسال',
  language: 'اللغة',
  english: 'الإنجليزية',
  arabic: 'العربية',
});

export type UiLabelKey = keyof typeof ARABIC_LABELS;
export function arabicLabel(key: UiLabelKey): string { return ARABIC_LABELS[key]; }
