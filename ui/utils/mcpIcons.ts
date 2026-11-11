/** Picks a recognisable icon for an MCP tool from its name, command and address. */
export interface ToolIcon { icon: string; color?: string }

const BRANDS: { match: RegExp; icon: string; color?: string }[] = [
  { match: /github/, icon: 'i-simple-icons-github', color: '#181717' },
  { match: /gitlab/, icon: 'i-simple-icons-gitlab', color: '#FC6D26' },
  { match: /playwright/, icon: 'i-simple-icons-playwright', color: '#2EAD33' },
  { match: /puppeteer/, icon: 'i-simple-icons-puppeteer', color: '#40B5A4' },
  { match: /notion/, icon: 'i-simple-icons-notion', color: '#000000' },
  { match: /slack/, icon: 'i-simple-icons-slack', color: '#4A154B' },
  { match: /linear/, icon: 'i-simple-icons-linear', color: '#5E6AD2' },
  { match: /figma/, icon: 'i-simple-icons-figma', color: '#F24E1E' },
  { match: /postgres/, icon: 'i-simple-icons-postgresql', color: '#4169E1' },
  { match: /sqlite/, icon: 'i-simple-icons-sqlite', color: '#003B57' },
  { match: /mysql/, icon: 'i-simple-icons-mysql', color: '#4479A1' },
  { match: /redis/, icon: 'i-simple-icons-redis', color: '#FF4438' },
  { match: /mongo/, icon: 'i-simple-icons-mongodb', color: '#47A248' },
  { match: /sentry/, icon: 'i-simple-icons-sentry', color: '#362D59' },
  { match: /stripe/, icon: 'i-simple-icons-stripe', color: '#635BFF' },
  { match: /supabase/, icon: 'i-simple-icons-supabase', color: '#3FCF8E' },
  { match: /vercel/, icon: 'i-simple-icons-vercel', color: '#000000' },
  { match: /cloudflare/, icon: 'i-simple-icons-cloudflare', color: '#F38020' },
  { match: /docker/, icon: 'i-simple-icons-docker', color: '#2496ED' },
  { match: /kube/, icon: 'i-simple-icons-kubernetes', color: '#326CE5' },
  { match: /jira|atlassian/, icon: 'i-simple-icons-jira', color: '#0052CC' },
  { match: /confluence/, icon: 'i-simple-icons-confluence', color: '#172B4D' },
  { match: /gdrive|google.?drive/, icon: 'i-simple-icons-googledrive', color: '#4285F4' },
  { match: /gmail/, icon: 'i-simple-icons-gmail', color: '#EA4335' },
  { match: /google.?maps/, icon: 'i-simple-icons-googlemaps', color: '#4285F4' },
  { match: /brave/, icon: 'i-simple-icons-brave', color: '#FB542B' },
  { match: /discord/, icon: 'i-simple-icons-discord', color: '#5865F2' },
  { match: /airtable/, icon: 'i-simple-icons-airtable', color: '#18BFFF' },
  { match: /asana/, icon: 'i-simple-icons-asana', color: '#F06A6A' },
  { match: /trello/, icon: 'i-simple-icons-trello', color: '#0052CC' },
  { match: /datadog/, icon: 'i-simple-icons-datadog', color: '#632CA6' },
  { match: /grafana/, icon: 'i-simple-icons-grafana', color: '#F46800' },
  { match: /firebase/, icon: 'i-simple-icons-firebase', color: '#FFCA28' },
  { match: /shopify/, icon: 'i-simple-icons-shopify', color: '#7AB55C' },
  { match: /mapbox/, icon: 'i-simple-icons-mapbox', color: '#000000' },
  { match: /zapier/, icon: 'i-simple-icons-zapier', color: '#FF4F00' },
  { match: /n8n/, icon: 'i-simple-icons-n8n', color: '#EA4B71' },
  { match: /perplexity/, icon: 'i-simple-icons-perplexity', color: '#1FB8CD' },
  { match: /huggingface|hugging-face/, icon: 'i-simple-icons-huggingface', color: '#FFD21E' },
  { match: /anthropic|claude/, icon: 'i-simple-icons-anthropic', color: '#CC9B7A' },
  { match: /openai/, icon: 'i-simple-icons-openai', color: '#412991' },
];

const GENERIC: { match: RegExp; icon: string }[] = [
  { match: /file|fs\b|filesystem|folder/, icon: 'i-lucide-folder' },
  { match: /browser|chrome|web|fetch|http|scrape|search/, icon: 'i-lucide-globe' },
  { match: /memory|knowledge|notes?/, icon: 'i-lucide-brain' },
  { match: /shell|terminal|bash|command|exec/, icon: 'i-lucide-terminal' },
  { match: /database|sql|db\b/, icon: 'i-lucide-database' },
  { match: /git\b|repo/, icon: 'i-lucide-git-branch' },
  { match: /docs?|context7|documentation/, icon: 'i-lucide-book-open' },
];

export function mcpIconFor(name: string, command = '', args = '', url = ''): ToolIcon {
  const hay = `${name} ${args} ${url} ${command}`.toLowerCase();
  const brand = BRANDS.find((b) => b.match.test(hay));
  if (brand) return { icon: brand.icon, color: brand.color };
  const generic = GENERIC.find((g) => g.match.test(hay));
  if (generic) return { icon: generic.icon };
  return { icon: url.trim() ? 'i-lucide-globe' : 'i-lucide-plug' };
}
