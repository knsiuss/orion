/**
 * @file invoice-parser.ts
 * @description Extract structured data from invoice images/PDFs.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Uses vision pipeline (src/vision/) for OCR + LLM extraction.
 *   Results fed into expense-tracker.ts for automatic expense logging.
 */
import { createLogger } from "../logger.js"
import { orchestrator } from "../engines/orchestrator.js"

const log = createLogger("finance.invoice-parser")

export interface ParsedInvoice {
  vendor: string
  amount: number
  currency: string
  date: string
  items: Array<{ description: string; amount: number }>
}

class InvoiceParser {
  async parse(text: string): Promise<ParsedInvoice | null> {
    try {
      const prompt = `Extract structured invoice data from this text. Return JSON with: vendor, amount, currency, date, items[{description, amount}]. If not an invoice, return null.\n\nText:\n${text.slice(0, 2000)}`
      const raw = await orchestrator.generate("fast", { prompt })
      const parsed = JSON.parse(raw) as ParsedInvoice
      log.debug("invoice parsed", { vendor: parsed.vendor, amount: parsed.amount })
      return parsed
    } catch (err) {
      log.warn("invoice parsing failed", { err })
      return null
    }
  }
}

export const invoiceParser = new InvoiceParser()
