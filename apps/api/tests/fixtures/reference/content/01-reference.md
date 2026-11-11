# Reference Document

This document exercises the parts of the layout engine the visual tests
compare against. Everything that could vary between machines is bundled: the
fonts live in `fonts/`, the image lives in `assets/`, and nothing depends on
what is installed on the host.

## Typography

Text is set in the bundled serif face. The point of this paragraph is to fill
enough of the page that the line breaking has something to do.

Body copy with a little more length to it, so that the justification and the
hyphenation have room to work.

## A table

| Column one | Column two | Column three | Column four |
| --- | --- | --- | --- |
| Alpha | Beta | Gamma | Delta |
| Epsilon | Zeta | Eta | Theta |
| Iota | Kappa | Lambda | Mu |

## An image

![A diagram](assets/diagram.svg)

## Page breaks

This paragraph stays on the first page, so the heading above it is not left
alone at the bottom.

<div style="break-before: page;"></div>

# Second page

The second page exists so the visual tests compare more than one page.

## A quote

> A quoted passage, set in italics with a rule down the left edge.

## The end

Nothing more to see here.
