package agentgate.procurement

# OPA/Rego reference policy matching the native edge-safe enforcement path.
# Input: {"action": {...}, "governance": {...}, "alreadyCommitted": number}

default decision := {
  "decision": "deny",
  "reason": "Action is not covered by the procurement policy.",
}

decision := {
  "decision": "deny",
  "reason": "Vendor is not on the approved supplier list.",
} if {
  input.action.tool == "create_purchase_request"
  not input.action.vendorId in input.governance.approvedVendors
}

else := {
  "decision": "deny",
  "reason": sprintf("Purchases must use %s.", [input.governance.allowedCurrency]),
} if {
  input.action.currency != input.governance.allowedCurrency
}

else := {
  "decision": "deny",
  "reason": "The purchasing category is blocked by policy.",
} if {
  input.action.category in input.governance.blockedCategories
}

else := {
  "decision": "deny",
  "reason": "The purchase would exceed the governed monthly budget.",
} if {
  input.alreadyCommitted + input.action.quantity * input.action.unitPrice > input.governance.monthlyBudget
}

else := {
  "decision": "approval",
  "reason": "Purchase value exceeds the automatic approval limit.",
} if {
  input.action.quantity * input.action.unitPrice > input.governance.autoApproveLimit
}

else := {
  "decision": "allow",
  "reason": "Purchase satisfies vendor, category, currency, and budget controls.",
} if {
  input.action.tool == "create_purchase_request"
}
