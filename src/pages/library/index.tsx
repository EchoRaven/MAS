import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SystemDoc } from "@/model/types";
import { useSystems } from "@/store/systems";
import { Integrations } from "./Integrations";
import { Models } from "./Models";
import { Schemas } from "./Schemas";
import { Tools } from "./Tools";

export function LibraryPage() {
  const { systemId } = useParams();
  const systems = useSystems((s) => s.systems);
  const updateStore = useSystems((s) => s.update);
  const navigate = useNavigate();
  if (!systemId) return systems.length ? <Navigate to={`/library/${systems[0].id}`} replace /> : <Navigate to="/" replace />;
  const doc = systems.find((s) => s.id === systemId);
  if (!doc) return <Navigate to="/" replace />;
  const update = (fn: (d: SystemDoc) => SystemDoc) => updateStore(doc.id, fn);
  return (
    <div className="h-full overflow-y-auto p-3 md:p-6">
      <Tabs defaultValue="models" className="mx-auto max-w-6xl space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={doc.id} onValueChange={(id) => navigate(`/library/${id}`)} items={systems.map((s) => ({ value: s.id, label: s.name }))} ariaLabel="Select system" className="max-w-64" />
          <TabsList>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="schemas">Schemas</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="models" className="mt-0">
          <Models doc={doc} update={update} />
        </TabsContent>
        <TabsContent value="tools" className="mt-0">
          <Tools doc={doc} update={update} />
        </TabsContent>
        <TabsContent value="schemas" className="mt-0">
          <Schemas doc={doc} update={update} />
        </TabsContent>
        <TabsContent value="integrations" className="mt-0">
          <Integrations />
        </TabsContent>
      </Tabs>
    </div>
  );
}
