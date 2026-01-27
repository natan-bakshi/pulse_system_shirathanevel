import React from "react";
import { Button } from "@/components/ui/button";
import { Contact } from "lucide-react";

export default function ContactPicker({ onContactSelect, className = "ml-2" }) {
  const handlePickContact = async () => {
    // Check if the API is supported
    if ('contacts' in navigator && 'select' in navigator.contacts) {
      try {
        const props = ['name', 'tel', 'email'];
        const contacts = await navigator.contacts.select(props, { multiple: false });
        
        if (contacts.length > 0) {
          const contact = contacts[0];
          
          let name = '';
          if (contact.name && contact.name.length > 0) {
            name = contact.name[0];
          }
          
          let phone = '';
          if (contact.tel && contact.tel.length > 0) {
            phone = contact.tel[0];
            // Normalize phone number
            // Remove all characters except digits and plus sign
            phone = phone.replace(/[^\d+]/g, '');
            
            // Replace +972 or 972 at the start with 0
            if (phone.startsWith('+972')) {
              phone = '0' + phone.substring(4);
            } else if (phone.startsWith('972')) {
              phone = '0' + phone.substring(3);
            }
          }
          
          let email = '';
          if (contact.email && contact.email.length > 0) {
            email = contact.email[0];
          }
          
          const contactData = {
            name: name,
            phone: phone,
            email: email
          };
          
          onContactSelect(contactData);
        }
      } catch (err) {
        console.error('Contact Picker error:', err);
        // Handle the specific iframe security error
        if (err.name === 'SecurityError' || (err.message && err.message.includes('top frame'))) {
            alert("בורר אנשי הקשר אינו זמין בתצוגה המקדימה, אך יעבוד כראוי באפליקציה הסופית (במכשירים תומכים).");
        } else {
            // Only alert if it's not a user cancellation (which might not always have a clear error code, but usually does)
            // However, browsers might throw simple errors. 
            // We'll keep it silent for cancellation or generic errors to avoid annoyance, 
            // or just log it.
        }
      }
    } else {
      alert("פיצ'ר זה אינו נתמך בדפדפן או במכשיר זה (נתמך בעיקר במובייל - Chrome/Android, Safari/iOS)");
    }
  };

  return (
    <Button 
      type="button" 
      variant="ghost" 
      size="sm" 
      onClick={handlePickContact}
      title="בחר מאנשי קשר"
      className={className}
    >
      <Contact className="h-4 w-4" />
    </Button>
  );
}