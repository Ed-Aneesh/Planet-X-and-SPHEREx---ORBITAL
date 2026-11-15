"""Uncertainty propagation and error budgets (Science item 3).

PHYSICAL IDEA. Every measured number is uncertain for several separate reasons:
random noise in the pixels (statistical: shrinks if you average more data) and
imperfect calibration or modelling (systematic: does NOT shrink by averaging,
and is often SHARED by many measurements, e.g. the absolute flux scale of a
detector). An honest result keeps those reasons separate, so a reader can see
which one dominates and what would improve the measurement.

FORMALISM.
 * A `Measured` value carries a list of `Term`s: (name, 1-sigma size, kind,
   shared?). Independent terms add in quadrature: sigma_total^2 = sum sigma_i^2.
 * propagate_linear(f, inputs) uses first-order Taylor expansion:
       sigma_f(term) = |df/dx_k| * sigma_k(term)
   with df/dx_k from a central finite difference. A term marked `shared` with the
   same name in several inputs is treated as FULLY CORRELATED: its contributions
   add linearly before squaring (e.g. a 5 % calibration error on two fluxes
   cancels exactly in their ratio, as it physically should).
 * monte_carlo(f, inputs) draws every term from a normal distribution (shared
   terms: one draw used by all inputs), evaluates f many times and reports the
   median and the 16th/84th percentiles. It catches non-linear cases (division by
   a noisy number, logarithms, 1/parallax) where the linear formula is wrong; we
   flag when the two methods disagree by more than 10 %.
 * Budget: each term's share of the total VARIANCE (sigma^2), which is what
   actually adds up to 100 %.
"""
import math
from dataclasses import dataclass, field

import numpy as np

from lab.stats import json_number

STATISTICAL, SYSTEMATIC = "statistical", "systematic"


@dataclass
class Term:
    name: str
    sigma: float
    kind: str = STATISTICAL
    shared: bool = False          # True: same-named terms in other inputs are 100 % correlated
    note: str = ""


@dataclass
class Measured:
    value: float
    unit: str = ""
    terms: list = field(default_factory=list)
    label: str = ""

    def add(self, name, sigma, kind=STATISTICAL, shared=False, note=""):
        sigma = abs(float(sigma))
        if math.isfinite(sigma) and sigma > 0:
            self.terms.append(Term(name, sigma, kind, shared, note))
        return self

    def _quad(self, kind=None):
        return math.sqrt(sum(t.sigma ** 2 for t in self.terms if kind is None or t.kind == kind))

    @property
    def sigma(self):
        return self._quad()

    @property
    def stat(self):
        return self._quad(STATISTICAL)

    @property
    def sys(self):
        return self._quad(SYSTEMATIC)

    def budget(self):
        """Rows sorted by size: each term, its sigma and its share of the total variance."""
        total = self.sigma ** 2
        rows = sorted(self.terms, key=lambda t: -t.sigma)
        return [{"term": t.name, "kind": t.kind, "sigma": json_number(t.sigma),
                 "share_pct": json_number(100.0 * t.sigma ** 2 / total if total > 0 else 0.0, 2),
                 "shared": t.shared, "note": t.note} for t in rows]

    def to_json(self, digits=None):
        return {"value": json_number(self.value, digits), "unit": self.unit, "label": self.label,
                "sigma": json_number(self.sigma, digits), "stat": json_number(self.stat, digits),
                "sys": json_number(self.sys, digits), "budget": self.budget()}

    def __repr__(self):
        return f"{self.value:.6g} ± {self.sigma:.3g} {self.unit} (stat {self.stat:.3g}, sys {self.sys:.3g})"


def _step(x, sigma):
    """Finite-difference step: small against both the value and its uncertainty."""
    scale = max(abs(x) * 1e-7, sigma * 1e-4, 1e-300)
    return scale


def propagate_linear(func, inputs, unit="", label=""):
    """First-order propagation of every term of every input through func(**values).

    inputs: dict name -> Measured (or plain float = exact). Returns a Measured whose
    terms keep their origin ('input: term'), so the budget shows where error comes from."""
    nominal = {k: (v.value if isinstance(v, Measured) else float(v)) for k, v in inputs.items()}
    f0 = float(func(**nominal))
    contributions = {}            # key -> [summed linear contribution, kind, shared, note]
    for key, m in inputs.items():
        if not isinstance(m, Measured):
            continue
        for t in m.terms:
            h = _step(m.value, t.sigma)
            up, down = dict(nominal), dict(nominal)
            up[key] += h
            down[key] -= h
            derivative = (float(func(**up)) - float(func(**down))) / (2.0 * h)
            c = derivative * t.sigma
            name = t.name if t.shared else f"{key}: {t.name}"
            slot = contributions.setdefault(name, [0.0, t.kind, t.shared, t.note])
            slot[0] += c                      # shared terms add LINEARLY (fully correlated)
            if not t.shared and slot[0] != c:
                raise ValueError(f"duplicate term name {name}")
    out = Measured(f0, unit, label=label)
    for name, (c, kind, shared, note) in contributions.items():
        out.add(name, c, kind, shared, note)
    return out


def monte_carlo(func, inputs, n=4000, seed=12345):
    """Monte Carlo propagation. Returns dict with median, p16, p84, mean, std and the
    linear result for comparison (and 'nonlinear': True when they differ > 10 %).
    func must accept numpy arrays (vectorised)."""
    rng = np.random.default_rng(seed)
    draws = {}
    shared_draws = {}
    for key, m in inputs.items():
        if not isinstance(m, Measured):
            draws[key] = np.full(n, float(m))
            continue
        x = np.full(n, m.value, float)
        for t in m.terms:
            if t.shared:
                z = shared_draws.setdefault(t.name, rng.standard_normal(n))
            else:
                z = rng.standard_normal(n)
            x = x + t.sigma * z
        draws[key] = x
    with np.errstate(all="ignore"):
        y = np.asarray(func(**draws), float)
    good = y[np.isfinite(y)]
    linear = propagate_linear(lambda **kw: func(**{k: np.asarray(v, float) for k, v in kw.items()}), inputs)
    if good.size < 10:
        return {"ok": False, "reason": "too few finite Monte Carlo samples", "linear": linear.to_json()}
    p16, p50, p84 = np.percentile(good, [15.865525393145707, 50.0, 84.13447460685429])
    half_width = 0.5 * (p84 - p16)
    nonlinear = linear.sigma > 0 and abs(half_width - linear.sigma) > 0.10 * linear.sigma
    return {"ok": True, "n": int(good.size), "median": float(p50), "p16": float(p16), "p84": float(p84),
            "mean": float(np.mean(good)), "std": float(np.std(good, ddof=1)),
            "half_width_68": float(half_width), "linear_sigma": float(linear.sigma),
            "nonlinear": bool(nonlinear), "fraction_finite": float(good.size / n)}


def scaled(m, factor, unit=None, label=None):
    """Multiply a Measured value and every term by an exact factor (unit conversion)."""
    out = Measured(m.value * factor, unit if unit is not None else m.unit, label=label or m.label)
    for t in m.terms:
        out.add(t.name, t.sigma * abs(factor), t.kind, t.shared, t.note)
    return out
