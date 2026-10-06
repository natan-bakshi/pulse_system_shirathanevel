import { readAll } from './eventReadiness.ts';
import { calculateEventBalance } from './eventBilling.ts';
import { effectiveMilestones } from './agreementRules.ts';

// Never rely on a queued reminder's amount/state or on payments loaded earlier in the run.
// Receipts linked to payments are evidence of those payments, not an additional payment.
export async function loadMilestonePaymentBalance(client, eventId, milestoneId, config = {}) {
 const [event, storedMilestone] = await Promise.all([
  client.entities.Event.get(eventId), client.entities.PaymentMilestone.get(milestoneId)
 ]);
 if (!event || !storedMilestone || storedMilestone.event_id !== eventId) throw new Error('לא ניתן לאמת את אבן הדרך באירוע');
 const agreement=await client.entities.EventAgreement.get(storedMilestone.agreement_id);
 if(!agreement)throw new Error('ההסכם אינו זמין');
 const milestone=effectiveMilestones(agreement,[storedMilestone])[0];
 const target = Number(milestone.cumulative_amount);
 if (milestone.cumulative_amount == null || !Number.isFinite(target) || target < 0) throw new Error('חסר סכום מצטבר תקין לאבן הדרך');
 const payments = await readAll(client.entities.Payment, { event_id: eventId });
 const { totalPaid, currency } = calculateEventBalance(event, [], payments,
  (Number(config.vat_rate) || 18) / 100, Number(config.usd_ils_exchange_rate) || 3.6);
 const outstanding = Math.round(Math.max(0, target - totalPaid) * 100) / 100;
 const active = agreement.active && event.status !== 'cancelled' && event.closing_agreement_id === milestone.agreement_id;
 return { milestone, totalPaid, cumulativeAmount: target, outstanding, currency,
  shouldSend: active && outstanding > 0, paid: outstanding === 0 };
}