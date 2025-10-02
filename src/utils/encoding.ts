export const encodeContent = (content: string) => {
  return content.replace(/[^\x20-\x7E\n\r\t]/g, "");
};