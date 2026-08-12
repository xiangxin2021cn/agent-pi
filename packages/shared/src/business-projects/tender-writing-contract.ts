/**
 * Compact writing contract injected into tender stage drafts and child briefs.
 * Full text lives in tender-intelligence-core/references/writing-contract.md.
 */

export const TENDER_WRITING_CONTRACT_BRIEF =
  'Writing: produce a bid-team artifact for THIS tender. Use the employer\'s terms, item codes, clause/sheet locators, and measurement language from the assigned sources. Do not use AI filler (Furthermore, Moreover, It is important to note, In conclusion, leverage, robust, seamless, cutting-edge, 综上所述, 值得注意的是, 赋能, 全方位, 一站式, 确保万无一失). Do not invent generic method-theatre or a textbook TOC the tender does not require. Formal returnables follow the employer\'s headings and language.';

export const TENDER_WRITING_CONTRACT_DRAFT = `<tender_writing_contract>
全链条约束（解析稿、组价底稿、边界说明、施工策划、进度/现金流说明、正式回标文件、对用户的阶段综述均适用）：
- 按本标书专业化写作：沿用雇主术语、条款号、清单编码、计量支付用语与回标目录；不要改写成通用施工教材或 AI 综述。
- 去 AI 味道：禁止“综上所述 / 值得注意的是 / 赋能 / 全方位 / Furthermore / It is important to note / leverage / robust / key takeaways”等套话；有条款写条款，有数字写数字，有缺口写缺口。
- 正式成果跟招标模板与评标要求；工作底稿写组价/施工/合规含义，不写文件目录或聊天复盘。
完整约定见 skill tender-intelligence-core 的 references/writing-contract.md。
</tender_writing_contract>`;
