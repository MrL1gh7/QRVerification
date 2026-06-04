declare module 'qrcode' {
  export interface QRCodeToStringOptions {
    type?: 'svg' | 'utf8' | 'terminal';
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    width?: number;
  }

  export function toString(
    text: string,
    options?: QRCodeToStringOptions
  ): Promise<string>;

  export function toBuffer(
    text: string,
    options?: Omit<QRCodeToStringOptions, 'type'>
  ): Promise<Buffer>;

  const QRCode: {
    toString: typeof toString;
    toBuffer: typeof toBuffer;
  };

  export default QRCode;
}
