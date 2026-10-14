/**
 * A comment that outgrows a handful of lines stops being a comment: it is read on every visit to the
 * file, it is not compiled or tested, and it drifts from the code under it the first time that code
 * changes. Asking for the "why" only and never the "what" sets no ceiling by itself, so a paragraph
 * of "why" reads as compliant while burying the function it describes. This is the ceiling.
 *
 * The measure is a run of consecutive comment lines rather than a share of the file, because the
 * failure being prevented is vertical: a wall of prose that pushes the code off the screen. Sharing
 * the file with a second file's worth of comments is the same defect whether the file is 40 lines or
 * 400, and a ratio can be walked around by appending unrelated code.
 *
 * Waive per block with `// eslint-disable-next-line betafied/comment-budget -- <reason>`; the
 * directive is not itself counted as prose, so it does not inflate the run it suppresses.
 */
const DEFAULT_MAX_CONSECUTIVE_LINES = 12;

/** A trailing comment on a code line annotates that line; it is not part of a prose block. */
function isOwnLineComment(sourceCode, comment) {
    if (comment.type === "Block") return true;
    const line = sourceCode.lines[comment.loc.start.line - 1] ?? "";
    return line.slice(0, comment.loc.start.column).trim() === "";
}

/** An inline waiver is a directive to this rule, not prose it should measure. */
function isDirectiveComment(comment) {
    return /^\s*eslint-(disable|enable)/.test(comment.value);
}

function lineCount(comment) {
    return comment.loc.end.line - comment.loc.start.line + 1;
}

export default {
    meta: {
        type: "suggestion",
        docs: {
            description:
                "Cap how many consecutive comment lines a block may run before the rationale belongs in a document"
        },
        schema: [
            {
                type: "object",
                properties: { max: { type: "integer", minimum: 2 } },
                additionalProperties: false
            }
        ],
        messages: {
            tooLong:
                "Comment block runs {{actual}} lines ({{max}} is the limit). Cut it to the part this code cannot be read without, or waive the block above with the reason it earns."
        }
    },
    create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const max = context.options[0]?.max ?? DEFAULT_MAX_CONSECUTIVE_LINES;

        return {
            Program() {
                const prose = sourceCode
                    .getAllComments()
                    .filter(
                        (comment) =>
                            !isDirectiveComment(comment) && isOwnLineComment(sourceCode, comment)
                    );

                let run = [];

                function flush() {
                    if (run.length === 0) return;
                    const lines = run.reduce((total, comment) => total + lineCount(comment), 0);
                    if (lines > max) {
                        const first = run[0];
                        const last = run[run.length - 1];
                        context.report({
                            loc: { start: first.loc.start, end: last.loc.end },
                            messageId: "tooLong",
                            data: { actual: String(lines), max: String(max) }
                        });
                    }
                    run = [];
                }

                for (const comment of prose) {
                    const previous = run[run.length - 1];
                    if (previous && comment.loc.start.line > previous.loc.end.line + 1) flush();
                    run.push(comment);
                }
                flush();
            }
        };
    }
};
