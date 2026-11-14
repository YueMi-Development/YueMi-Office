== Layout

YueMi Office renders with Typst, which has its own layout model. The rules
below are ordinary Typst; nothing here is YueMi-specific.

=== Page setup

The page size comes from `project.json`. The theme adds margins and a
running footer:

```typ
#set page(
  margin: (x: 22mm, y: 25mm),
  footer: context [
    #counter(page).display() of #counter(page).final().first()
  ],
)
```

=== Typography

#table(
  columns: (auto, 1fr),
  stroke: (x, y) => if y == 0 { (top: 0.6pt, bottom: 0.6pt) } else { (bottom: 0.3pt,) },
  table.header([*Element*], [*Treatment*]),
  [Body text], [Serif, 11pt, generous line height],
  [Headings], [Sans serif, and never left alone at the foot of a page],
  [Code], [Monospace on a light background],
)

=== Keeping a heading with its content

```typ
#show heading: it => block(above: 6mm, below: 2mm, it)
```

=== A table that stays readable

#table(
  columns: (1fr, auto, auto),
  stroke: (x, y) => if y == 0 { (top: 0.6pt, bottom: 0.6pt) } else { (bottom: 0.3pt,) },
  table.header([*Feature*], [*Milestone*], [*Status*]),
  [Project format], [M1], [Done],
  [Editor and preview], [M1], [Done],
  [PDF export], [M1], [Done],
  [Typst export], [M1], [Done],
  [Templates and font bundling], [M2], [Planned],
  [AI assistant], [M3, M4], [Planned],
)

== Next

Edit this file and the preview updates as you type. Then export the PDF and
compare it to what you saw.
