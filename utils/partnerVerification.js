const { PartnerDocument, PartnerBankAccount } = require("../models/Index");

/**
 * This is the single source of truth for the Affiliate KYC checklist.
 * The partner-facing checklist and activation gate both read from it.
 */
const REQUIRED_DOCUMENTS_BY_PARTNER_TYPE = {
  affiliate: ["pan_card", "cancelled_cheque"]
};

const getRequiredDocumentTypes = (partnerType) =>
  REQUIRED_DOCUMENTS_BY_PARTNER_TYPE[partnerType] || REQUIRED_DOCUMENTS_BY_PARTNER_TYPE.affiliate;

/**
 * Label for the Affiliate's primary performance metric on the dashboard.
 */
const DEFAULT_METRIC_LABEL_BY_PARTNER_TYPE = {
  affiliate: "Leads Referred"
};

const getDefaultMetricLabel = (partnerType) =>
  DEFAULT_METRIC_LABEL_BY_PARTNER_TYPE[partnerType] || DEFAULT_METRIC_LABEL_BY_PARTNER_TYPE.affiliate;

const isKycDocumentsVerified = async (partnerId, partnerType) => {
  const requiredTypes = getRequiredDocumentTypes(partnerType);

  const documents = await PartnerDocument.find({ partnerId, documentType: { $in: requiredTypes } });

  const verifiedTypes = new Set(
    documents.filter((d) => d.verification.status === "verified").map((d) => d.documentType)
  );

  return requiredTypes.every((type) => verifiedTypes.has(type));
};

const isPartnerFullyVerified = async (partnerId, partnerType) => {
  const [allDocsVerified, bankAccount] = await Promise.all([
    isKycDocumentsVerified(partnerId, partnerType),
    PartnerBankAccount.findOne({ partnerId })
  ]);

  const bankVerified = bankAccount?.verification?.status === "verified";

  return allDocsVerified && bankVerified;
};

module.exports = {
  isPartnerFullyVerified,
  isKycDocumentsVerified,
  getRequiredDocumentTypes,
  REQUIRED_DOCUMENTS_BY_PARTNER_TYPE,
  getDefaultMetricLabel
};
