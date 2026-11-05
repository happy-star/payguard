export interface SamplePrompt {
  id: string;
  label: string;
  blurb: string;
  prompt: string;
}

export const samplePrompts: SamplePrompt[] = [
  {
    id: "brand",
    label: "Brand design",
    blurb: "Two acceptance checks and a due date",
    prompt:
      "I'm Maya Chen, a brand designer. Priya Shah at Northwind Studio wants a homepage and a 3-page style guide. $1,800 USD. Hold the money until she approves the Figma file and I deliver the exported assets. Due November 20. One round of revisions included; anything after that is extra.",
  },
  {
    id: "edit",
    label: "Essay edit",
    blurb: "A single delivery condition",
    prompt:
      "Need a freelance editor for a 4,000-word essay. I'll pay Jordan Lee $220. Release when the draft is returned with tracked changes and a summary of edits. No rush fee.",
  },
  {
    id: "csv",
    label: "CSV importer",
    blurb: "Split payment and a vague scope",
    prompt:
      "Build a small inventory CSV importer for my Shopify side project. Budget 950 dollars. Freelancer is Sam Okonkwo. Pay half when the script runs on my sample file and the rest when I can import 500 rows without errors. I'm worried the scope is vague.",
  },
];
