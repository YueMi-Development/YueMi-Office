// The theme of the reference document.
//
// The visual tests render this document on every operating system and
// compare the pages, so everything the layout depends on is set here
// rather than left to a default that could change.

#let theme(body) = {
  set page(
    paper: "a4",
    margin: (x: 22mm, y: 25mm),
    footer: context {
      align(center, text(font: "Inter", size: 8pt, fill: rgb("#6b7280"))[
        #counter(page).display()
      ])
    },
  )

  set text(font: "Source Serif 4", size: 11.5pt, fill: rgb("#1f2937"))
  set par(justify: true, leading: 0.7em)

  show heading.where(level: 1): it => {
    set text(font: "Inter", weight: "bold", size: 22pt)
    block(above: 0pt, below: 5mm, it)
  }
  show heading.where(level: 2): it => {
    set text(font: "Inter", weight: "bold", size: 14pt)
    block(above: 8mm, below: 3mm, it)
  }

  show quote: it => block(
    above: 5mm,
    below: 5mm,
    inset: (left: 5mm),
    stroke: (left: 1.2pt + rgb("#cbd5e1")),
    text(style: "italic", fill: rgb("#475569"), it),
  )

  body
}
