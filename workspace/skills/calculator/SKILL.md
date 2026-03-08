---
name: calculator
description: "Perform advanced calculations including algebra, statistics, finance, and unit conversion."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: false
    emoji: "🔢"
---

# Calculator

## When to Use

Use for:
- Arithmetic and algebraic expressions
- Statistical calculations (mean, median, std dev, percentile)
- Financial math (compound interest, loan payments, ROI)
- Percentage and ratio calculations
- Unit conversions

Do NOT use for:
- Symbolic math requiring CAS (use wolfram-alpha skill)
- Real-time market data (use stock-quotes / currency-converter skills)

## Supported Operations

| Category | Examples |
|----------|---------|
| Basic | `(3 + 4) * 2 / 7` |
| Algebra | `solve x^2 - 5x + 6 = 0` |
| Statistics | `mean([12, 45, 67, 23, 89])` |
| Finance | `compound interest: P=10000, r=7%, n=12, t=5 years` |
| Loan | `monthly payment: principal=50000, rate=5%, term=60mo` |
| Conversion | `120 mph to km/h`, `5 acres to m²` |

## Example Invocations

- "What is 15% of 3,750?"
- "Calculate the monthly payment for a $250,000 loan at 4.5% over 30 years."
- "What's the standard deviation of [23, 45, 12, 67, 89, 34]?"
- "If I invest $500/month at 8% annually for 20 years, what do I end up with?"

## What It Does

1. Parses the expression or word problem
2. Performs the calculation (native math engine)
3. Shows the result with intermediate steps where helpful
4. Formats financial results with proper currency notation
