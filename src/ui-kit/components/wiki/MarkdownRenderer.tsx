import React from "react";
import Image from "next/image";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { rewriteWikiHref, rewriteWikiImageSrc } from "@/core/wiki/wikiLinks";
import { WikiBlockquote } from "./WikiBlockquote";
import styles from "./MarkdownRenderer.module.css";

const EXTERNAL_WEB_LINK = /^https?:\/\//i;
const REMARK_PLUGINS = [remarkGfm];

function buildComponents(toolSlug: string): Components {
  return {
    a: ({ href, children }) => {
      if (!href) return <>{children}</>;

      const target = rewriteWikiHref(toolSlug, href);
      if (EXTERNAL_WEB_LINK.test(target)) {
        return (
          <a href={target} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }
      if (target.startsWith("/")) return <Link href={target}>{children}</Link>;
      return <a href={target}>{children}</a>;
    },
    img: ({ src, alt }) => {
      if (typeof src !== "string") return null;

      return (
        <Image
          src={rewriteWikiImageSrc(toolSlug, src)}
          alt={alt ?? ""}
          width={0}
          height={0}
          sizes="100vw"
          unoptimized
          className={styles.image}
        />
      );
    },
    table: ({ children }) => (
      <div className={styles.tableScroll}>
        <table>{children}</table>
      </div>
    ),
    blockquote: ({ children }) => <WikiBlockquote>{children}</WikiBlockquote>,
  };
}

export interface MarkdownRendererProps {
  body: string;
  toolSlug: string;
}

/** Renders a wiki page body. Raw HTML in the Markdown is not rendered. */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ body, toolSlug }) => (
  <div className={styles.markdown}>
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={buildComponents(toolSlug)}>
      {body}
    </ReactMarkdown>
  </div>
);
