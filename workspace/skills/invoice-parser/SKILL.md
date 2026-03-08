---
name: invoice-parser
description: "Parse invoices and receipts to extract vendor, amount, date, and line items."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🧾"
---

# Invoice Parser

## When to Use

Use for:
- Extracting key fields from a pasted invoice or receipt
- Parsing a PDF invoice (via vision pipeline)
- Logging invoice data to expense tracker
- Checking invoice totals and detecting discrepancies

Do NOT use for:
- Automated invoice fetching from email (combine with email-summary skill)
- Accounting software integration (manual review required)

## Supported Formats

- **Plain text**: Paste invoice text directly
- **PDF**: Upload via vision pipeline (multimodal LLM parses the document)
- **Image**: Receipt photo via vision pipeline

## Extracted Fields

```
Vendor:       <company name>
Invoice #:    <id>
Date:         <issue date>
Due Date:     <payment due>
Subtotal:     <amount>
Tax:          <amount>
Total:        <amount>
Currency:     <ISO code>
Line Items:   [ { description, qty, unit_price, total } ]
Payment:      <method if present>
```

## Example Invocations

- "Parse this invoice." (paste text below)
- "Extract the total and due date from this PDF receipt."
- "Log this invoice to my expense tracker."
- "Check if the line items add up to the stated total."

## What It Does

1. Accepts pasted text or an image/PDF via vision pipeline
2. Extracts all key invoice fields using LLM parsing
3. Validates that line items sum to the stated total
4. Flags discrepancies or missing required fields
5. Offers to log the parsed data to the expense tracker
