## Layout

YueMi renders with WeasyPrint, which supports CSS Paged Media. The rules
below are ordinary CSS; nothing here is YueMi-specific.

### Page setup

The page size comes from `project.json`. This stylesheet adds margins and a
running footer:

```css
@page {
  margin: 25mm 22mm 20mm;
}

@page {
  @bottom-center {
    content: counter(page) " of " counter(pages);
    font-size: 9pt;
    color: #666;
  }
}
```

### Typography

| Element | Treatment |
|---|---|
| Body text | Serif, 11pt, generous line height |
| Headings | Sans serif, and never left alone at the foot of a page |
| Code | Monospace on a light background |

### Keeping a heading with its content

```css
h1,
h2 {
  page-break-after: avoid;
}
```

### A table that stays readable

```css
table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  border-bottom: 1px solid #ddd;
  padding: 6px 8px;
  text-align: left;
}
```

| Feature | Milestone | Status |
|---|---|---|
| Project format | M1 | Done |
| Editor and preview | M1 | Done |
| PDF export | M1 | Done |
| Markdown export | M1 | Done |
| Templates and font bundling | M2 | Planned |
| AI assistant | M3, M4 | Planned |

## Next

Edit this file and the preview updates as you type. Then export the PDF and
compare it to what you saw.
