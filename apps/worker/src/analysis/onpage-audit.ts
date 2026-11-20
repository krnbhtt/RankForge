import type { Extraction } from '@rankforge/schema';
import type { RuleResult } from './schema-audit.js';

export interface OnPageAudit {
  structure: {
    hasTitle: boolean;
    isTitleLengthOptimal: boolean;
    hasMetaDescription: boolean;
    hasSingleH1: boolean;
    hasH2H3Hierarchy: boolean;
    hasCanonical: boolean;
  };
  images: {
    allHaveAltText: boolean;
    descriptiveFilenames: boolean;
    imageCount: number;
    isHeroPreloaded: boolean;
  };
  rules: RuleResult[];
}

function countH1(tree: Extraction['headingTree']): number {
  let n = 0;
  const walk = (nodes: Extraction['headingTree']) => {
    for (const node of nodes) {
      if (node.level === 1) n++;
      walk(node.children);
    }
  };
  walk(tree);
  return n;
}

function hasHierarchy(tree: Extraction['headingTree']): boolean {
  let h2 = 0;
  const walk = (nodes: Extraction['headingTree']) => {
    for (const node of nodes) {
      if (node.level === 2 || node.level === 3) h2++;
      walk(node.children);
    }
  };
  walk(tree);
  return h2 >= 2;
}

const GENERIC_FILENAME = /^(img|image|dsc|screenshot|photo|pic|picture|untitled)?[-_ ]*\d*$|^[0-9a-f]{8,}$|^[0-9a-f-]{20,}$/i;

function isDescriptiveFilename(src: string): boolean {
  let name: string;
  try {
    name = decodeURIComponent(new URL(src, 'https://x.invalid').pathname.split('/').pop() ?? '');
  } catch {
    return false;
  }
  const stem = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]?\d+x\d*$/i, '');
  return stem.length >= 4 && !GENERIC_FILENAME.test(stem) && /[a-z]{3,}/i.test(stem);
}

/** On-page and image SEO checks (spec F4.5). Pure code. */
export function auditOnPage(extraction: Extraction, primaryKeyword?: string): OnPageAudit {
  const rules: RuleResult[] = [];
  const add = (id: string, severity: RuleResult['severity'], title: string, evidence: string, penaltyPoints: number) =>
    rules.push({ id, severity, title, evidence, penaltyPoints });

  const { meta, headingTree, images } = extraction;
  const titleLen = meta.title.trim().length;
  const hasTitle = titleLen > 0;
  const titleOptimal = titleLen >= 30 && titleLen <= 60;
  if (!hasTitle) add('onpage.title.missing', 'critical', 'The page has no title', 'The <title> tag is empty or missing.', 2);
  else if (!titleOptimal) {
    add(
      'onpage.title.length',
      'medium',
      titleLen < 30 ? 'The page title is too short' : 'The page title is too long',
      `The title is ${titleLen} characters ("${meta.title.slice(0, 70)}"); 30 to 60 reads best in search results.`,
      1
    );
  }

  const descLen = meta.description.trim().length;
  const hasDescription = descLen > 0;
  if (!hasDescription) add('onpage.meta.missing', 'high', 'No meta description', 'The meta description tag is empty or missing.', 2);

  const h1Count = countH1(headingTree);
  const singleH1 = h1Count === 1;
  if (h1Count !== 1) {
    add(
      'onpage.h1.count',
      'high',
      h1Count === 0 ? 'The page has no H1 heading' : 'The page has more than one H1 heading',
      `Found ${h1Count} H1 heading${h1Count === 1 ? '' : 's'} on the page.`,
      2
    );
  } else if (primaryKeyword) {
    const words = primaryKeyword.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const h1 = extraction.content.h1.toLowerCase();
    if (words.length && !words.some((w) => h1.includes(w))) {
      add('onpage.h1.keyword', 'low', 'The H1 does not mention the main keyword', `H1 is "${extraction.content.h1.slice(0, 80)}"; keyword is "${primaryKeyword}".`, 0);
    }
  }

  const hierarchy = hasHierarchy(headingTree);
  if (!hierarchy) {
    add('onpage.headings.hierarchy', 'medium', 'Few or no H2/H3 sub-headings', 'Fewer than two H2 or H3 headings were found under the H1.', 1);
  }

  const hasCanonical = Boolean(meta.canonical);
  if (!hasCanonical) add('onpage.canonical.missing', 'medium', 'No canonical link', 'The page has no rel=canonical link.', 2);

  const withAlt = images.filter((i) => i.alt.trim().length > 0).length;
  const allAlt = images.length > 0 && withAlt === images.length;
  if (images.length > 0 && !allAlt) {
    add('images.alt', 'high', 'Images without alt text', `${images.length - withAlt} of ${images.length} product images have no alt text.`, 3);
  }
  const descriptive = images.length > 0 && images.filter((i) => isDescriptiveFilename(i.src)).length >= images.length / 2;
  if (images.length > 0 && !descriptive) {
    add('images.filenames', 'low', 'Image file names are not descriptive', 'Most image files are named with numbers or hashes instead of words.', 1);
  }
  if (images.length < 4) {
    add('images.count', 'medium', 'Fewer than four product images', `Only ${images.length} product image${images.length === 1 ? '' : 's'} found; 4 or more is the benchmark.`, 2);
  }
  const heroPreloaded = extraction.pageSignals?.heroPreloaded ?? false;
  if (!heroPreloaded) {
    add('images.hero.preload', 'low', 'The hero image is not preloaded', 'No preload link for the main product image was found in the page head.', 1);
  }

  return {
    structure: {
      hasTitle,
      isTitleLengthOptimal: titleOptimal,
      hasMetaDescription: hasDescription,
      hasSingleH1: singleH1,
      hasH2H3Hierarchy: hierarchy,
      hasCanonical,
    },
    images: { allHaveAltText: allAlt, descriptiveFilenames: descriptive, imageCount: images.length, isHeroPreloaded: heroPreloaded },
    rules,
  };
}
