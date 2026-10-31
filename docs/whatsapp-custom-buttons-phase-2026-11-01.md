# WA-I08e: Custom WhatsApp notification buttons — 2026-11-01

Scope: Pulse / Shirat HaNevel, Green API personal supplier notifications.

Implemented in code:
- Per NotificationTemplate owner editor for 1-3 ordered buttons with editable labels.
- Supported: supplier calendar, supplier assignments, notification preferences, event-specific smart link, WhatsApp office inquiry, public HTTPS URL, copy message reference, call office, and a signed reminder acknowledgement reply.
- Existing assignment approve/reject remain unchanged.
- Server validates the selected action, links, company, template identity and recipient scope. Enqueue captures immutable settings in WhatsAppOutbox, worker uses the captured settings. One provider request per message. No added background job or per-send DB query.
- Reminder acknowledgement uses the existing V2 signed receipt pipeline and remains disabled globally unless the owner deliberately activates it.
- Existing policy schema version 1 remains readable; custom configuration uses version 2.
- The final provider transport rechecks custom link targets, exact reply binding, original source identity and the office phone number from trusted worker configuration.

Safety limitations:
- Smart event URLs are supported for known event reminder or scheduled event sources. Pending-assignment reminders have an EventService ID rather than an Event ID and cannot use that smart link yet.
- Other recipients, group chats, Wasender, billing, cancellation and document messages stay on their previous routes.
- Original-message quoting stays unenabled because SendInteractiveButtons does not document quotedMessageId.
- Green API has a beta warning, limits buttons to 3 and captions to 25 characters. A real device check is required before claiming delivery.

Next:
1. Finish full tests and build, checkpoint and production deployment verification.
2. Live owner verification of one appropriate new supplier notification before broad rollout; never send a test automatically.
3. Add verified event provenance for pending reminders without per-send lookups.
4. Improve legacy smart-link generation across InApp/Push and expand templates for clients/admins with separate recipient safety review.
5. Expand non-business reactions only after signed inbound handling and idempotency tests.
6. Revisit quote/tag limitations with Green API and return to queue performance and failure monitoring.

Detailed code modules: greenSupplierCustomLinks.ts, greenSupplierTemplateButtonsPolicy.ts, greenSupplierButtonSnapshot.ts, greenSupplierNavigation.ts, whatsappV2ReminderOutbound.ts, WhatsAppCustomButtonEditor.jsx, WhatsAppTemplateButtonSettings.jsx.

No provider messages, settings changes, webhook changes or queue rescheduling were performed by this code change.
