import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import ContactPicker from "../ui/ContactPicker";
import { contactExtraValue } from "@/lib/eventFields";

export default function OrganizerContactsSection({ contacts, onChange, config, disabled }) {
  // Don't render if no contacts_config is defined for this organizer type
  // (config is null when no specific configuration exists)
  if (!config) return null;

  const label = config?.label || "אנשי קשר";
  const itemLabel = config?.item_label || "איש קשר";
  const extraFields = config?.extra_fields || [];

  const handleChange = (index, field, value) => {
    const updated = [...contacts];
    const extra = extraFields.find(f => f.id === field);
    updated[index] = extra ? { ...updated[index], custom_fields: { ...updated[index].custom_fields, [field]: value }, custom_field_labels: { ...updated[index].custom_field_labels, [field]: extra.name }, ...(extra.system_key === 'role' ? { role: value } : {}) } : { ...updated[index], [field]: value };
    onChange(updated);
  };

  const handleContactSelect = (index, contactData) => {
    const updated = [...contacts];
    updated[index] = {
      ...updated[index],
      name: contactData.name || updated[index].name,
      phone: contactData.phone || updated[index].phone,
      email: contactData.email || updated[index].email,
    };
    onChange(updated);
  };

  const addContact = () => {
    const emptyContact = { id: crypto.randomUUID(), name: "", phone: "", email: "", custom_fields: {} };
    extraFields.forEach(f => { emptyContact.custom_fields[f.id] = ""; });
    onChange([...contacts, emptyContact]);
  };

  const removeContact = (index) => {
    onChange(contacts.filter((_, i) => i !== index));
  };

  return (
    <div className="p-3 sm:p-6 border rounded-lg bg-gray-50/80">
      <div className="flex justify-between items-center mb-3 sm:mb-4 border-b pb-2">
        <h3 className="text-base sm:text-lg font-semibold">{label}</h3>
        <Button type="button" variant="outline" size="sm" onClick={addContact} disabled={disabled}>
          <Plus className="h-4 w-4 ml-1" />הוסף {itemLabel}
        </Button>
      </div>
      <div className="space-y-3">
        {contacts.map((contact, index) => (
          <div key={contact.id || index} className="border p-4 rounded-lg bg-gray-50/70">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-600">{itemLabel} {index + 1}</span>
              <div className="flex items-center gap-1">
                <ContactPicker
                  disabled={disabled}
                  onContactSelect={(c) => handleContactSelect(index, c)}
                  className="shrink-0"
                />
                {(
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeContact(index)} disabled={disabled}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[150px]">
                <Input
                  value={contact.name || ""}
                  onChange={(e) => handleChange(index, "name", e.target.value)}
                  placeholder="שם מלא"
                  disabled={disabled}
                />
              </div>
              <div className="flex-1 min-w-[150px]">
                <Input
                  value={contact.phone || ""}
                  onChange={(e) => handleChange(index, "phone", e.target.value)}
                  placeholder="טלפון"
                  disabled={disabled}
                />
              </div>
              <div className="flex-1 min-w-[150px]">
                <Input
                  type="email"
                  value={contact.email || ""}
                  onChange={(e) => handleChange(index, "email", e.target.value)}
                  placeholder="אימייל"
                  disabled={disabled}
                />
              </div>
            </div>
            {extraFields.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {extraFields.map(field => (
                  <div key={field.id} className="flex-1 min-w-[150px]">
                    {field.type === 'select' ? (
                      <Select
                        value={contactExtraValue(contact, field)}
                        onValueChange={(v) => handleChange(index, field.id, v)}
                        disabled={disabled}
                      >
                        <SelectTrigger><SelectValue placeholder={field.name} /></SelectTrigger>
                        <SelectContent>
                          {(field.options || []).map(opt => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={field.type === 'phone' ? 'tel' : field.type === 'email' ? 'email' : 'text'}
                        value={contactExtraValue(contact, field)}
                        onChange={(e) => handleChange(index, field.id, e.target.value)}
                        placeholder={field.name}
                        disabled={disabled}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
