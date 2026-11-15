"""A small, explicit processing pipeline: named stages, declared inputs, isolated failures.

Why: a science result is only as trustworthy as the chain that made it. Every stage
here says what it needs, records how long it took, what it read (provenance: the
exact URLs, releases and software versions) and why it failed or was skipped. One
broken stage (say, Gaia is down) never takes the others with it: the stages that
do not depend on it still run, and the report says plainly what is missing.

    retrieve -> calibrate -> measure -> uncertainty -> analyse (SED, variability) -> visualise
    gaia ------------------^ (positions at each exposure date, distance for L and R)
    cube (independent: the DR1 all-sky spectral cube at the same position)
"""

import time
import traceback
from dataclasses import dataclass, field

from lab import LAB_VERSION


class Skip(Exception):
    """Raised by a stage that decides not to run (missing optional input, nothing to do)."""


class Cancelled(Exception):
    pass


@dataclass
class Stage:
    name: str
    func: callable
    needs: tuple = ()               # names of stages whose output this stage uses
    optional: tuple = ()            # stages used if they succeeded, ignored otherwise
    title: str = ""
    what: str = ""                  # one line for the website: what this stage does, physically


@dataclass
class Context:
    params: dict
    results: dict = field(default_factory=dict)       # stage name -> output (Python objects)
    provenance: list = field(default_factory=list)
    log_lines: list = field(default_factory=list)
    progress: callable = None
    cancelled: callable = None

    def log(self, stage, text):
        line = f"[{stage}] {text}"
        self.log_lines.append(line)
        if self.progress:
            self.progress(stage, text)

    def cite(self, stage, kind, value, note=""):
        """Record where something came from (URL, release, software version)."""
        self.provenance.append({"stage": stage, "kind": kind, "value": value, "note": note,
                                "time_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})

    def check(self):
        if self.cancelled and self.cancelled():
            raise Cancelled()

    def get(self, name, default=None):
        return self.results.get(name, default)


class Pipeline:
    def __init__(self, stages):
        names = [s.name for s in stages]
        if len(set(names)) != len(names):
            raise ValueError("duplicate stage names")
        for s in stages:
            for dep in s.needs + s.optional:
                if dep not in names or names.index(dep) >= names.index(s.name):
                    raise ValueError(f"stage {s.name}: dependency {dep} must come earlier")
        self.stages = stages

    def describe(self):
        return [{"name": s.name, "title": s.title or s.name, "what": s.what, "needs": list(s.needs),
                 "optional": list(s.optional)} for s in self.stages]

    def run(self, ctx, only=None):
        """Run every stage (or only those named, plus what they need). Returns the stage report."""
        wanted = self._closure(only) if only else {s.name for s in self.stages}
        report, status = [], {}
        ctx.cite("pipeline", "software", f"ORBITAL science lab {LAB_VERSION}")
        for s in self.stages:
            entry = {"name": s.name, "title": s.title or s.name, "status": "pending", "seconds": 0.0}
            report.append(entry)
            if s.name not in wanted:
                entry.update(status="not requested")
                status[s.name] = "not requested"
                continue
            missing = [d for d in s.needs if status.get(d) != "ok"]
            if missing:
                entry.update(status="skipped", reason="needs " + ", ".join(f"{d} ({status.get(d)})" for d in missing))
                status[s.name] = "skipped"
                ctx.log(s.name, entry["reason"])
                continue
            entry["status"] = "running"
            if ctx.progress:
                ctx.progress(s.name, "started")
            t0 = time.perf_counter()
            try:
                ctx.check()
                out = s.func(ctx)
                ctx.results[s.name] = out if out is not None else {}
                entry["status"] = "ok"
            except Skip as why:
                entry.update(status="skipped", reason=str(why))
            except Cancelled:
                entry.update(status="cancelled")
                status[s.name] = "cancelled"
                entry["seconds"] = round(time.perf_counter() - t0, 2)
                break
            except Exception as error:                       # isolate: report, keep going
                entry.update(status="failed", reason=f"{type(error).__name__}: {str(error)[:300]}",
                             trace=traceback.format_exc(limit=4)[-1200:])
            entry["seconds"] = round(time.perf_counter() - t0, 2)
            status[s.name] = entry["status"]
            ctx.log(s.name, f"{entry['status']} in {entry['seconds']} s" +
                    (f": {entry.get('reason')}" if entry.get("reason") else ""))
        return report

    def _closure(self, only):
        by = {s.name: s for s in self.stages}
        unknown = [n for n in only if n not in by]
        if unknown:
            raise ValueError("unknown stage(s): " + ", ".join(unknown))
        out, todo = set(), list(only)
        while todo:
            n = todo.pop()
            if n in out:
                continue
            out.add(n)
            todo.extend(by[n].needs)
        return out
