import { Construction } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full min-h-[calc(100vh-3.5rem)] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
          <Construction className="h-8 w-8 text-primary" />
        </div>
        <Badge variant="outline" className="mb-3 border-primary/30 bg-primary/10 text-primary">
          المرحلة التالية
        </Badge>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
        <p className="mt-4 text-xs text-muted-foreground">
          هذه الوحدة جاهزة للتطوير بعد التحقق من نجاح الوحدات الأساسية.
        </p>
      </div>
    </div>
  );
}
