# Vditor Integration Project

Parent: [[Home]]  
Related: [[Projects/Roadmap]], [[Reference/API]]

#project/vditor #editor

## Goals

Support the Obsidian syntax extensions in vscode-office, including:

1. Callout `> [!NOTE]`
2. WikiLink `[[page]]`
3. Tag `#tag/sub`
4. Block references `^id` and `[[page#^id]]`

## Key Paragraph

Other files can reference this paragraph as [[Projects/Vditor#^scope]].

^scope

## Embedded Meeting Notes

![[Notes/Meeting-Notes]]

## Reference to the API Authentication Section

See [[Reference/API#^auth-section]] (should point to the authentication block in the API document).

> [!IMPORTANT] Regression scope
> After changing Lute, run `obsidian_test.go` in `my_lute`, and open every file of this test vault to check round-trip editing.
