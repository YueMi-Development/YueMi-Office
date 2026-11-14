// The theme of the welcome document.
//
// It is a Typst file that exports a `theme` function. The renderer wraps the
// document in it, so everything set here applies to the whole document.

#let theme(body) = {
  set page(
    paper: "a4",
    margin: (x: 22mm, y: 25mm),
    footer: context {
      align(center, text(font: "Inter", size: 9pt, fill: rgb("#666666")))[
        #counter(page).display() of #counter(page).final().first()
      ])
    },
  )

  set text(font: "Inter", size: 10.5pt, fill: rgb("#111827"))
  set par(justify: true, leading: 0.65em)

  show heading.where(level: 1): it => {
    set text(weight: "bold", size: 24pt)
    block(above: 0pt, below: 6mm, it)
  }
  show heading.where(level: 2): it => {
    set text(weight: "bold", size: 15pt)
    block(above: 8mm, below: 3mm, it)
  }
  show heading.where(level: 3): it => {
    set text(weight: "bold", size: 12pt)
    block(above: 6mm, below: 2mm, it)
  }

  show list: it => block(above: 0pt, below: 3mm, it)
  show enum: it => block(above: 0pt, below: 3mm, it)

  show quote: it => block(
    above: 3mm,
    below: 3mm,
    inset: (left: 4mm),
    stroke: (left: 1.2pt + rgb("#d1d5db")),
    text(fill: rgb("#4b5563"), it),
  )

  show raw: it => block(
    fill: rgb("#f3f4f6"),
    inset: 3mm,
    radius: 1mm,
    text(size: 9pt, it),
  )

  body
}
