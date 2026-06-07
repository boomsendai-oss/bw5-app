import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function yen(n: number): string {
  return `¥${Number(n).toLocaleString('ja-JP')}`;
}
