import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dest = join(import.meta.dirname, '..', 'resources', 'knowledge', 'tender-sa-sanral');
mkdirSync(dest, { recursive: true });

const copies = [
  [
    'E:/南非项目/投标项目/South Africa/ROUTE 3 SECTION 1/Agent Pi Outputs/260627-wide-orbit/C5.1_路床_单价推导.md',
    'C5.1_路床_单价推导.md',
  ],
  [
    'E:/南非项目/投标项目/South Africa/N2 high way/Submit documents/N2-18施工策划报告_R05修订版.md',
    'N2-18施工策划报告_R05修订版.md',
  ],
  [
    'E:/南非项目/投标项目/South Africa/N2 high way/Submit documents/N2-18-Work_Plan_and_Proposed_Methodology.docx',
    'N2-18-Work_Plan_and_Proposed_Methodology.docx',
  ],
  [
    'E:/南非项目/投标项目/South Africa/N2 high way/Submit documents/S-Curve_Cash_Flow_Chart.html',
    'S-Curve_Cash_Flow_Chart.html',
  ],
];

for (const [src, name] of copies) {
  if (!existsSync(src)) {
    console.error('MISSING', src);
    continue;
  }
  const out = join(dest, name);
  copyFileSync(src, out);
  console.log('OK', name, statSync(out).size);
}

const submit = 'E:/南非项目/投标项目/South Africa/N2 high way/Submit documents';
for (const file of readdirSync(submit)) {
  if (file.startsWith('Attachment 2') && file.endsWith('.pdf')) {
    copyFileSync(join(submit, file), join(dest, 'Attachment2_Plant_Histogram_R00.pdf'));
    console.log('OK Attachment2_Plant_Histogram_R00.pdf');
  }
  if (file.startsWith('Attachment 3') && file.endsWith('.pdf')) {
    copyFileSync(join(submit, file), join(dest, 'Attachment3_Labour_Histogram_R00.pdf'));
    console.log('OK Attachment3_Labour_Histogram_R00.pdf');
  }
}

console.log('DEST', readdirSync(dest));
