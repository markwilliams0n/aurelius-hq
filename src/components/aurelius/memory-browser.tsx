"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Search,
  Trash2,
  User,
  Briefcase,
  Building,
  Hash,
  FileText,
  BookOpen,
  Calendar,
  ChevronRight,
  ArrowLeft,
  FolderKanban,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

type MemoryItem = {
  entity: {
    id: string;
    name: string;
    type: string;
    summary: string | null;
  };
  facts: Array<{
    id: string;
    content: string;
    category: string | null;
    createdAt: Date;
  }>;
};

type MemoryOverview = {
  counts: {
    people: number;
    companies: number;
    projects: number;
    resources: number;
    dailyNotes: number;
    total: number;
  };
  recentNotes: string[];
  structure: Array<{
    name: string;
    path: string;
    count: number;
    icon: string;
  }>;
};

type SearchResult = {
  path: string;
  content: string;
  score: number;
  collection: string;
  entityType: string;
  entityName: string;
  category: string;
};

const typeIcons: Record<string, React.ReactNode> = {
  person: <User className="w-4 h-4" />,
  project: <Briefcase className="w-4 h-4" />,
  company: <Building className="w-4 h-4" />,
  resource: <BookOpen className="w-4 h-4" />,
  "daily-note": <Calendar className="w-4 h-4" />,
  topic: <Hash className="w-4 h-4" />,
  document: <FileText className="w-4 h-4" />,
  briefcase: <Briefcase className="w-4 h-4" />,
  user: <User className="w-4 h-4" />,
  building: <Building className="w-4 h-4" />,
  book: <BookOpen className="w-4 h-4" />,
};

export function MemoryBrowser({
  initialMemory,
}: {
  initialMemory: MemoryItem[];
}) {
  const [activeTab, setActiveTab] = useState<"browse" | "daily" | "search">("browse");
  const [memory, setMemory] = useState(initialMemory);
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [deepSearch, setDeepSearch] = useState(false);
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [browseData, setBrowseData] = useState<{
    type: string;
    items?: Array<{ name: string; isDirectory: boolean; preview?: string | null }>;
    content?: string | object;
    format?: string;
  } | null>(null);

  // Load overview on mount
  useEffect(() => {
    fetch("/api/memory")
      .then(res => res.json())
      .then(setOverview)
      .catch(console.error);
  }, []);

  // Handle search
  const handleSearch = async () => {
    if (!search.trim()) return;

    setIsSearching(true);
    try {
      const searchType = deepSearch ? 'hybrid' : 'keyword';
      const res = await fetch(`/api/memory/search?q=${encodeURIComponent(search)}&type=${searchType}`);
      const data = await res.json();
      setSearchResults(data.results || []);
      setActiveTab("search");
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  // Browse to a path
  const browseTo = async (path: string) => {
    try {
      const res = await fetch(`/api/memory/browse/${path}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setBrowseData(data);
      setCurrentPath(path);
      setActiveTab("browse"); // Switch to browse tab when navigating
    } catch (error) {
      console.error("Browse error:", error);
      toast.error("Could not load path");
    }
  };

  const handleDeleteFact = async (factId: string) => {
    try {
      const response = await fetch(`/api/memory/${factId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete");
      }

      setMemory((prev) =>
        prev.map((item) => ({
          ...item,
          facts: item.facts.filter((f) => f.id !== factId),
        }))
      );

      toast.success("Fact deleted");
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete fact");
    }
  };

  const totalFacts = memory.reduce((sum, item) => sum + item.facts.length, 0);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{overview?.counts.total ?? memory.length} entities</span>
        <span>·</span>
        <span>{totalFacts} facts</span>
        <span>·</span>
        <span>{overview?.counts.dailyNotes ?? 0} daily notes</span>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={deepSearch ? "Semantic search..." : "Search memory..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-10"
          />
        </div>
        <button
          onClick={() => setDeepSearch(!deepSearch)}
          className={`px-3 rounded-md border transition-colors flex items-center gap-1.5 text-sm ${
            deepSearch
              ? "bg-gold/20 border-gold/40 text-gold"
              : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground hover:border-gold/30"
          }`}
          title={deepSearch ? "Deep search: semantic + reranking (slower)" : "Quick search: keyword matching (fast)"}
        >
          <Sparkles className="w-4 h-4" />
          <span className="hidden sm:inline">{deepSearch ? "Deep" : "Quick"}</span>
        </button>
        <Button onClick={handleSearch} disabled={isSearching}>
          {isSearching ? "..." : "Search"}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "browse"
              ? "text-gold border-b-2 border-gold"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => { setActiveTab("browse"); setCurrentPath(null); setBrowseData(null); }}
        >
          <FolderKanban className="w-4 h-4 inline mr-2" />
          Browse
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "daily"
              ? "text-gold border-b-2 border-gold"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("daily")}
        >
          <Calendar className="w-4 h-4 inline mr-2" />
          Daily Notes
        </button>
        {searchResults.length > 0 && (
          <button
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "search"
                ? "text-gold border-b-2 border-gold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("search")}
          >
            <Search className="w-4 h-4 inline mr-2" />
            Results ({searchResults.length})
          </button>
        )}
      </div>

      {/* Content */}
      {activeTab === "browse" && (
        currentPath && browseData ? (
          <BrowseView
            path={currentPath}
            data={browseData}
            onNavigate={browseTo}
            onBack={() => {
              const parts = currentPath.split("/");
              if (parts.length > 1) {
                browseTo(parts.slice(0, -1).join("/"));
              } else {
                setCurrentPath(null);
                setBrowseData(null);
              }
            }}
            onGoHome={() => { setCurrentPath(null); setBrowseData(null); }}
          />
        ) : (
          <PARAOverview
            overview={overview}
            memory={memory}
            expandedEntity={expandedEntity}
            onExpandEntity={setExpandedEntity}
            onDeleteFact={handleDeleteFact}
            onBrowse={browseTo}
          />
        )
      )}

      {activeTab === "daily" && (
        <DailyNotesView recentNotes={overview?.recentNotes || []} />
      )}

      {activeTab === "search" && (
        <SearchResultsView results={searchResults} onNavigate={browseTo} />
      )}
    </div>
  );
}

function PARAOverview({
  overview,
  memory,
  expandedEntity,
  onExpandEntity,
  onDeleteFact,
  onBrowse,
}: {
  overview: MemoryOverview | null;
  memory: MemoryItem[];
  expandedEntity: string | null;
  onExpandEntity: (id: string | null) => void;
  onDeleteFact: (id: string) => void;
  onBrowse: (path: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* PARA Structure */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {overview.structure.map((item) => (
            <button
              key={item.path}
              onClick={() => onBrowse(item.path)}
              className="p-4 rounded-lg bg-secondary/50 border border-border hover:border-gold/50 transition-colors text-left"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center text-gold">
                  {typeIcons[item.icon]}
                </div>
                <span className="font-medium">{item.name}</span>
              </div>
              <div className="text-2xl font-bold text-gold">{item.count}</div>
            </button>
          ))}
        </div>
      )}

      {/* Entity list */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">All Entities</h3>
        {memory.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No memories yet. Start chatting to build knowledge.
          </div>
        ) : (
          memory.map((item) => (
            <Card key={item.entity.id}>
              <CardHeader
                className="cursor-pointer"
                onClick={() =>
                  onExpandEntity(expandedEntity === item.entity.id ? null : item.entity.id)
                }
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center text-gold">
                    {typeIcons[item.entity.type] || <Hash className="w-4 h-4" />}
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-lg">{item.entity.name}</CardTitle>
                    <CardDescription className="capitalize">
                      {item.entity.type} · {item.facts.length} facts
                    </CardDescription>
                  </div>
                  <span className="text-muted-foreground text-sm">
                    {expandedEntity === item.entity.id ? "▼" : "▶"}
                  </span>
                </div>
              </CardHeader>

              {expandedEntity === item.entity.id && (
                <CardContent>
                  {item.entity.summary && (
                    <p className="text-sm text-muted-foreground mb-4 italic">
                      {item.entity.summary}
                    </p>
                  )}

                  <div className="space-y-2">
                    {item.facts.map((fact) => (
                      <div
                        key={fact.id}
                        className="flex items-start gap-3 py-2 px-3 rounded-md bg-secondary/50 group"
                      >
                        <div className="flex-1">
                          <p className="text-sm">{fact.content}</p>
                          {fact.category && (
                            <span className="text-xs text-muted-foreground capitalize">
                              {fact.category}
                            </span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
                          onClick={() => onDeleteFact(fact.id)}
                        >
                          <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function BrowseView({
  path,
  data,
  onNavigate,
  onBack,
  onGoHome,
}: {
  path: string;
  data: {
    type: string;
    items?: Array<{ name: string; isDirectory: boolean; preview?: string | null }>;
    content?: string | object;
    format?: string;
  };
  onNavigate: (path: string) => void;
  onBack: () => void;
  onGoHome: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <button onClick={onGoHome} className="text-gold hover:underline">
          life
        </button>
        {path.split("/").map((segment, i, arr) => (
          <span key={i} className="flex items-center gap-2">
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
            {i === arr.length - 1 ? (
              <span className="text-foreground">{segment}</span>
            ) : (
              <button
                onClick={() => onNavigate(arr.slice(0, i + 1).join("/"))}
                className="text-gold hover:underline"
              >
                {segment}
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back
      </Button>

      {/* Content */}
      {data.type === "directory" && data.items && (
        <div className="space-y-2">
          {data.items
            .filter(item => !item.name.startsWith("_"))
            .map((item) => (
              <button
                key={item.name}
                onClick={() => onNavigate(`${path}/${item.name}`)}
                className="w-full p-3 rounded-lg bg-secondary/50 border border-border hover:border-gold/50 transition-colors text-left flex items-center gap-3"
              >
                {item.isDirectory ? (
                  <FolderKanban className="w-5 h-5 text-gold" />
                ) : (
                  <FileText className="w-5 h-5 text-muted-foreground" />
                )}
                <div className="flex-1">
                  <div className="font-medium">
                    {item.name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                  </div>
                  {item.preview && (
                    <div className="text-xs text-muted-foreground truncate">
                      {item.preview}
                    </div>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
        </div>
      )}

      {data.type === "file" && (
        <div className="p-4 rounded-lg bg-secondary/50 border border-border">
          {data.format === "markdown" ? (
            <pre className="whitespace-pre-wrap text-sm">{data.content as string}</pre>
          ) : data.format === "json" ? (
            <pre className="whitespace-pre-wrap text-sm text-muted-foreground">
              {JSON.stringify(data.content, null, 2)}
            </pre>
          ) : (
            <pre className="whitespace-pre-wrap text-sm">{String(data.content)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function DailyNotesView({ recentNotes }: { recentNotes: string[] }) {
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState<string | null>(null);

  const loadNote = async (filename: string) => {
    try {
      const res = await fetch(`/api/memory/browse/daily/${filename}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setNoteContent(data.content);
      setSelectedNote(filename);
    } catch (error) {
      console.error("Load note error:", error);
      toast.error("Could not load note");
    }
  };

  return (
    <div className="space-y-4">
      {selectedNote ? (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedNote(null); setNoteContent(null); }}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to notes
          </Button>
          <h3 className="font-medium">{selectedNote.replace(".md", "")}</h3>
          <div className="p-4 rounded-lg bg-secondary/50 border border-border">
            <pre className="whitespace-pre-wrap text-sm">{noteContent}</pre>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {recentNotes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No daily notes yet. Start chatting to create entries.
            </div>
          ) : (
            recentNotes.map((note) => (
              <button
                key={note}
                onClick={() => loadNote(note)}
                className="w-full p-3 rounded-lg bg-secondary/50 border border-border hover:border-gold/50 transition-colors text-left flex items-center gap-3"
              >
                <Calendar className="w-5 h-5 text-gold" />
                <span className="font-medium">{note.replace(".md", "")}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Type badge colors
const typeBadgeStyles: Record<string, string> = {
  person: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  company: "bg-purple-500/20 text-purple-400 border-purple-500/40",
  project: "bg-green-500/20 text-green-400 border-green-500/40",
  resource: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  "daily-note": "bg-gold/20 text-gold border-gold/40",
  unknown: "bg-gray-500/20 text-gray-400 border-gray-500/40",
};

// Relevance indicator (score to visual)
function RelevanceIndicator({ score }: { score: number }) {
  // Score typically ranges 0-1, higher is better
  const percentage = Math.min(100, Math.round(score * 100));
  const bars = Math.ceil((percentage / 100) * 4); // 1-4 bars

  return (
    <div className="flex gap-0.5 items-center" title={`Relevance: ${percentage}%`}>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all ${
            i <= bars ? "bg-gold h-3" : "bg-border h-2"
          }`}
        />
      ))}
    </div>
  );
}

// Type filter options
const typeFilters = [
  { value: "all", label: "All", icon: null },
  { value: "person", label: "People", icon: <User className="w-3 h-3" /> },
  { value: "company", label: "Companies", icon: <Building className="w-3 h-3" /> },
  { value: "project", label: "Projects", icon: <Briefcase className="w-3 h-3" /> },
  { value: "resource", label: "Resources", icon: <BookOpen className="w-3 h-3" /> },
  { value: "daily-note", label: "Notes", icon: <Calendar className="w-3 h-3" /> },
];

function SearchResultsView({
  results,
  onNavigate,
}: {
  results: SearchResult[];
  onNavigate: (path: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Filter results by type
  const filteredResults = typeFilter === "all"
    ? results
    : results.filter(r => r.entityType === typeFilter);

  // Count results by type for filter badges
  const typeCounts = results.reduce((acc, r) => {
    acc[r.entityType] = (acc[r.entityType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Convert search result path to browse path
  const getNavigatePath = (result: SearchResult): string => {
    // Remove leading "life/" and file extensions
    let path = result.path
      .replace(/^life\//, "")
      .replace(/\/summary\.md$/, "")
      .replace(/\/items\.json$/, "")
      .replace(/\.md$/, "")
      .replace(/\.json$/, "");

    // For daily notes, use the daily browse path
    if (result.entityType === "daily-note") {
      const dateMatch = result.path.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        return `daily/${dateMatch[1]}.md`;
      }
    }

    return path;
  };

  return (
    <div className="space-y-4">
      {/* Type filter */}
      <div className="flex gap-2 flex-wrap">
        {typeFilters.map((filter) => {
          const count = filter.value === "all" ? results.length : (typeCounts[filter.value] || 0);
          const isActive = typeFilter === filter.value;

          // Don't show filter if no results of that type
          if (filter.value !== "all" && count === 0) return null;

          return (
            <button
              key={filter.value}
              onClick={() => setTypeFilter(filter.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? "bg-gold/20 text-gold border border-gold/40"
                  : "bg-secondary/50 text-muted-foreground border border-border hover:border-gold/30"
              }`}
            >
              {filter.icon}
              {filter.label}
              <span className={`ml-1 ${isActive ? "text-gold" : "text-muted-foreground"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Results */}
      <div className="space-y-3">
        {filteredResults.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {results.length === 0 ? "No results found" : "No results for this filter"}
          </div>
        ) : (
          filteredResults.map((result, i) => (
            <button
              key={i}
              onClick={() => onNavigate(getNavigatePath(result))}
              className="w-full text-left p-4 rounded-lg bg-secondary/50 border border-border hover:border-gold/30 hover:bg-secondary/70 transition-colors cursor-pointer"
            >
              {/* Header: Icon, Name, Type Badge, Relevance */}
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center text-gold shrink-0">
                  {typeIcons[result.entityType] || <Hash className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-foreground truncate">
                      {result.entityName || "Unknown"}
                    </h4>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${
                        typeBadgeStyles[result.entityType] || typeBadgeStyles.unknown
                      }`}
                    >
                      {result.entityType === "daily-note" ? "note" : result.entityType}
                    </span>
                  </div>
                  {result.category && (
                    <p className="text-xs text-muted-foreground">{result.category}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <RelevanceIndicator score={result.score} />
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>

              {/* Content snippet - only show if meaningful */}
              {result.content &&
               result.content.length > 10 &&
               !result.content.toLowerCase().includes(result.entityName.toLowerCase()) && (
                <p className="text-sm text-muted-foreground line-clamp-2 ml-12">
                  {result.content}
                </p>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
