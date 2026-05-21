declare module "piexifjs" {
  const piexif: {
    load: (dataUrl: string) => Record<string, Record<number, unknown> | null>;
    dump: (exifObj: Record<string, Record<number, unknown> | null>) => string;
    insert: (exifBytes: string, dataUrl: string) => string;
    remove: (dataUrl: string) => string;
    ImageIFD: { DateTime: number; [k: string]: number };
    ExifIFD: {
      DateTimeOriginal: number;
      DateTimeDigitized: number;
      [k: string]: number;
    };
    GPSIFD: Record<string, number>;
  };
  export default piexif;
}
