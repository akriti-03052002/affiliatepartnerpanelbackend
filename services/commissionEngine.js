const { PartnerCommission, Partner, PartnerNotification, PartnerBankAccount } = require("../models/Index");
const logActivity = require("../utils/logActivity");

// No commission is created — not held, not pending, nothing — for a
// partner whose payout bank account hasn't cleared both the automated
// Razorpay check and the admin's final review (see
// adminBankController.verifyBankAccount, the only place this flips to
// "eligible"). Settlement-holding (utils/settlementHold.js) is a separate,
// later concern about *paying out* already-generated commission — this is
// about not generating it in the first place.
const assertCommissionEligible = async (partner) => {
  const bankAccount = await PartnerBankAccount.findOne({ partnerId: partner._id });
  if (!bankAccount || bankAccount.commissionEligibility !== "eligible") {
    throw new Error("This partner's bank account isn't verified and eligible for rewards yet — verify it before marking deals as won.");
  }
};

/* ============================================================
   COMMISSION FOR A WON LEAD
   Runs when an admin closes a lead as won. The admin decides the
   commission for each deal and enters it directly — there is no
   rule-based calculation. It is a one-time payment per deal.
   Writes the ledger row, bumps the
   partner's cached stats and notifies the partner.
============================================================ */

const createCommissionForWonLead = async ({ lead, dealValue, screenCount, commissionAmount, req, adminUser }) => {
  const partner = await Partner.findById(lead.partnerId);

  if (!partner) {
    throw new Error("Partner not found for this lead.");
  }

  await assertCommissionEligible(partner);

  // One deal pays one commission, once. There are no recurring or follow-up
  // payments; the unique index on PartnerCommission.referralId backs this up.
  if (await PartnerCommission.exists({ referralId: lead._id })) {
    throw new Error("A Referral Reward has already been recorded for this lead.");
  }

  const commission = await PartnerCommission.create({
    partnerId: partner._id,
    referralId: lead._id,
    transaction: { revenue: dealValue, screenCount, currency: "INR" },
    calculation: {
      commissionType: "manual",
      fixedAmount: commissionAmount,
      grossCommission: commissionAmount,
      deductions: 0,
      netCommission: commissionAmount
    },
    // Approved straight away: the admin decided this amount when marking
    // the lead won, so there is no separate approval step.
    settlement: {
      eligibleAt: new Date(),
      status: "approved"
    }
  });

  partner.stats.wonDeals += 1;
  partner.stats.totalRevenue += dealValue;
  partner.stats.totalCommission += commissionAmount;
  partner.stats.pendingCommission += commissionAmount;
  await partner.save();

  await logActivity({
    partnerId: partner._id,
    performedByType: "spotx_user",
    performedByUserId: adminUser._id,
    activityType: "commission_created",
    entityType: "PartnerCommission",
    entityId: commission._id,
    description: `Referral Reward of ${commissionAmount.toFixed(2)} set for the won deal with ${lead.customer.companyName}.`,
    req
  });

  await PartnerNotification.create({
    partnerId: partner._id,
    type: "commission_created",
    title: "Referral Reward earned",
    message: `Your lead ${lead.customer.companyName} closed as a won deal. You earned a ₹${commissionAmount.toLocaleString("en-IN")} Referral Reward.`,
    entity: { type: "PartnerCommission", entityId: commission._id }
  });

  return commission;
};

module.exports = { createCommissionForWonLead };
