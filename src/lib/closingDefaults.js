// Frontend defaults mirror the server's agreement defaults; settings remain stored in AppSettings.
export const closingDefaults = {
  closing_regular_multiplier: '1', closing_exceptional_multiplier: '2',
  closing_reminder_enabled: 'true', closing_reminder_days: '3', closing_reminder_time: '09:00',
  closing_send_copy: 'true', closing_notify_admin: 'true', closing_exceptional_notice: 'true', closing_exceptional_notice_days: '3',
  closing_token_required: 'true', closing_deposit_required: 'true',
  closing_regular_text: 'אני מאשר/ת לשירת הנבל לחייב ידנית את הכרטיס שמסרתי עבור תשלומי האירוע בהתאם לאבני הדרך ולתקרת החיוב המפורטות במסמך, אם לא התקבל תשלום באמצעי חלופי עד מועד התשלום. לא תתבצע סליקה אוטומטית.',
  closing_exceptional_text: 'אני מאשר/ת חיוב ידני בכרטיס עבור נזק או חיוב חריג שאני חב/ה בו לפי הסכם ההתקשרות, עד לתקרה המפורטת במסמך. תינתן לי אפשרות לשלם באמצעי חלופי בהתאם למדיניות ההודעה המפורטת כאן.',
  closing_changes_text: 'שינוי בשירותים או במחיר שביקשתי או אישרתי במפורש בערוץ מתועד יצורף להזמנה ולהסכם. כל שינוי יתועד עם תוכנו, מחירו, מועדו וזהות המאשר. שינוי מהותי בתקרת חיוב או בהרשאת השימוש בכרטיס יובא לאישורי המפורש; הסכמה זו אינה הרשאה לשינוי חד-צדדי.',
  closing_message_template: 'שלום {{customer_name}}, בהתאם להסכם עבור האירוע {{event_name}}, סכום של {{amount}} {{currency}} מיועד לתשלום עד {{due_date}}. ניתן להעביר תשלום באמצעי חלופי עד המועד. אם לא יתקבל, שירת הנבל רשאית לבצע חיוב ידני בכרטיס השמור בהתאם להרשאה שעליה חתמת. עמלת סליקה, ככל שתחול, תתווסף לפי ההסכם. לשאלות: {{business_phone}}.',
  closing_form_language: 'he', closing_message_language: 'he', closing_terms_text: '', closing_terms_text_en: '',
  closing_regular_text_en: 'I authorize Shirat Hanevel to charge the card I provide manually for event payments according to the milestones and limits in this agreement if I have not paid by another method by the due date. No automatic charges will be made.',
  closing_exceptional_text_en: 'I authorize manual card charges for damage or exceptional amounts I owe under this agreement, up to the specified limit. I may use an alternative payment method subject to the notice terms here.',
  closing_changes_text_en: 'Changes to services or pricing that I explicitly request or approve through a documented channel will be recorded with the details, price, time and approver. A material change to card authorization or its limit requires my express consent.',
  closing_message_template_en: 'Hello {{customer_name}}, for the event {{event_name}}, {{amount}} {{currency}} is due by {{due_date}}. You may pay by another method by then; otherwise Shirat Hanevel may charge the saved card manually under your signed authorization. Any applicable processing fee will be added under the agreement. Questions: {{business_phone}}.',
  closing_invitation_template: '', closing_invitation_template_en: '', closing_otp_template: '', closing_otp_template_en: '', closing_signed_template: '', closing_signed_template_en: ''
};