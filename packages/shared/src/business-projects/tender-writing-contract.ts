/**
 * Compact writing contract injected into tender stage drafts and child briefs.
 * Full text lives in tender-intelligence-core/references/writing-contract.md.
 */

export const TENDER_WRITING_CONTRACT_BRIEF =
  'Writing: produce a bid-team artifact for THIS tender. Use the employer\'s terms, item codes, clause/sheet locators, and measurement language from the assigned sources. Do not use AI filler (Furthermore, Moreover, It is important to note, In conclusion, leverage, robust, seamless, cutting-edge, 综上所述, 值得注意的是, 赋能, 全方位, 一站式, 确保万无一失). Do not invent generic method-theatre or a textbook TOC the tender does not require. Formal returnables follow the employer\'s headings and language. Read skill tender-formal-writing before drafting.';

export const TENDER_WRITING_CONTRACT_DRAFT = `<tender_writing_contract>
[skill:tender-formal-writing]
硬禁令（写法见该 skill，不要在此发挥）：
- 按本标书写作：雇主术语、条款号、清单编码、计量支付用语、回标目录。
- 去 AI 味道：禁止综上所述 / 值得注意的是 / 赋能 / 全方位 / Furthermore / It is important to note / leverage / robust。
- 有条款写条款，有数字写数字，有缺口写缺口；禁止教材腔与文件目录腔。
</tender_writing_contract>`;
