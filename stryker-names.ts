// See vitest.stryker.config.ts. Test-name matching only; nothing else uses ' > '.
const match = String.prototype.match;
String.prototype.match = function (this: string, pattern: string | RegExp) {
  return pattern instanceof RegExp && this.includes(' > ') ? match.call(this.split(' > ').join(' '), pattern) : match.call(this, pattern as never);
} as typeof String.prototype.match;
