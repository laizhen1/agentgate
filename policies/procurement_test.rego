package agentgate.procurement_test

import data.agentgate.procurement

governance := {
  "approvedVendors": ["acme-supply"],
  "allowedCurrency": "USD",
  "blockedCategories": ["gift-cards"],
  "autoApproveLimit": 1000,
  "monthlyBudget": 25000,
}

test_small_approved_purchase if {
  procurement.decision with input as {
    "action": {
      "tool": "create_purchase_request",
      "vendorId": "acme-supply",
      "sku": "LAP-14",
      "quantity": 1,
      "unitPrice": 899,
      "currency": "USD",
      "category": "laptops",
    },
    "governance": governance,
    "alreadyCommitted": 0,
  } == {
    "decision": "allow",
    "reason": "Purchase satisfies vendor, category, currency, and budget controls.",
  }
}

test_unapproved_vendor_denied if {
  decision := procurement.decision with input as {
    "action": {
      "tool": "create_purchase_request",
      "vendorId": "shadow-vendor",
      "sku": "CARD",
      "quantity": 1,
      "unitPrice": 20,
      "currency": "USD",
      "category": "gift-cards",
    },
    "governance": governance,
    "alreadyCommitted": 0,
  }
  decision.decision == "deny"
}

test_large_purchase_requires_approval if {
  decision := procurement.decision with input as {
    "action": {
      "tool": "create_purchase_request",
      "vendorId": "acme-supply",
      "sku": "LAP-14",
      "quantity": 2,
      "unitPrice": 899,
      "currency": "USD",
      "category": "laptops",
    },
    "governance": governance,
    "alreadyCommitted": 0,
  }
  decision.decision == "approval"
}
