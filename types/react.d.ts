declare module '*.css';

declare namespace React {
  export type ReactNode =
    | string
    | number
    | boolean
    | null
    | undefined
    | ReactElement<any, any>
    | Iterable<ReactNode>;

  export interface ReactElement<P = any, T extends string | JSXElementConstructor<any> = string | JSXElementConstructor<any>> {
    type: T;
    props: P;
    key: string | null;
  }

  export type JSXElementConstructor<P> = (props: P) => ReactElement<any, any> | null;

  export interface HTMLAttributes<T> {
    className?: string;
    children?: ReactNode;
    style?: Record<string, any>;
    id?: string;
    title?: string;
    role?: string;
    tabIndex?: number;
    onClick?: (e: any) => void;
    onScroll?: (e: any) => void;
    ref?: any;
    [key: string]: any;
  }

  export interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    onClick?: (e: any) => void;
  }

  export interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    type?: string;
    value?: string | number | readonly string[];
    defaultValue?: string | number | readonly string[];
    checked?: boolean;
    defaultChecked?: boolean;
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    onChange?: (e: any) => void;
  }

  export interface FormEvent<T = Element> {
    preventDefault(): void;
    stopPropagation(): void;
    target: T;
  }

  export interface ChangeEvent<T = Element> {
    target: T;
  }

  export function useState<T>(initialState: T | (() => T)): [T, (newState: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useRef<T>(initialValue: T | null): { current: T | null };
  export function forwardRef<T, P = {}>(
    render: (props: P, ref: any) => ReactElement<any, any> | null
  ): any;
}

declare module 'react' {
  export = React;
}

declare namespace JSX {
  interface Element extends React.ReactElement<any, any> {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare module 'next' {
  export interface Metadata {
    title?: string;
    description?: string;
    [key: string]: any;
  }
}

declare module 'next/server' {
  export interface NextRequest extends Request {
    json(): Promise<any>;
    nextUrl: URL;
  }

  export class NextResponse extends Response {
    static json(body: any, init?: ResponseInit): NextResponse;
    static redirect(url: string | URL, status?: number): NextResponse;
  }
}

declare module 'next/navigation' {
  export interface AppRouterInstance {
    push(href: string): void;
    replace(href: string): void;
    back(): void;
    forward(): void;
    refresh(): void;
  }
  export function useRouter(): AppRouterInstance;
  export function useSearchParams(): URLSearchParams;
  export function useParams(): Record<string, string>;
}

declare module 'next/link' {
  import type { ReactNode } from 'react';
  export interface LinkProps {
    href: string;
    children?: ReactNode;
    className?: string;
    [key: string]: any;
  }
  export default function Link(props: LinkProps): React.ReactElement;
}

declare module 'lucide-react' {
  import type { HTMLAttributes } from 'react';
  export interface LucideProps extends HTMLAttributes<SVGSVGElement> {
    size?: number | string;
    strokeWidth?: number | string;
  }
  export const ArrowRight: (props: LucideProps) => React.ReactElement;
  export const Sparkles: (props: LucideProps) => React.ReactElement;
  export const ShieldCheck: (props: LucideProps) => React.ReactElement;
  export const AlertCircle: (props: LucideProps) => React.ReactElement;
  export const Check: (props: LucideProps) => React.ReactElement;
  export const ChevronRight: (props: LucideProps) => React.ReactElement;
  export const ChevronDown: (props: LucideProps) => React.ReactElement;
  export const Copy: (props: LucideProps) => React.ReactElement;
  export const ExternalLink: (props: LucideProps) => React.ReactElement;
}

declare module 'clsx' {
  export type ClassValue = any;
  export function clsx(...inputs: ClassValue[]): string;
  export default clsx;
}

declare module 'tailwind-merge' {
  export function twMerge(...classLists: any[]): string;
}

declare module 'tailwindcss' {
  export interface Config {
    [key: string]: any;
  }
}
