const major = Number(process.versions.node.split('.')[0]);
if (major !== 22) {
  console.error(`\n[home-inventory-mvp] Node.js 22 is required. Current: ${process.version}`);
  console.error('Please run: export PATH="/opt/homebrew/opt/node@22/bin:$PATH"');
  process.exit(1);
}
