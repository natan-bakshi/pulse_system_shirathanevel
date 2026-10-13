// Legacy incident-specific recovery has been retired.
// All WhatsApp message management now runs through WhatsAppOutbox.
// This explicit tombstone also disables any previously deployed invocation path
// after publication, preventing accidental replay of manually resolved incidents.
Deno.serve(() => Response.json({
  success:false,
  error:'This incident recovery endpoint is retired. Use the central WhatsApp queue in system settings.'
},{status:410}));
