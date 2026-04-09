"""Bounded observations of values. Never call user repr(), getters, or iterators."""
from __future__ import annotations

import types
from collections import deque, defaultdict, OrderedDict, Counter

MAX_ITEMS = 128
MAX_OBJECTS = 256
MAX_IDENTITIES = 4096
MAX_DEPTH = 8
MAX_STRING = 4096


def type_name(value):
    return type.__dict__["__name__"].__get__(type(value))[:100]


class Snapshotter:
    def __init__(self):
        # Retain observed identities so recycled CPython addresses cannot alias old IDs.
        # The runtime memory policy and this finite registry bound the retention.
        self.identities = {}
        self.objects = {}

    def begin(self):
        self.objects = {}

    def scalar(self, type_, value, truncated=False):
        result = {"kind": "scalar", "type": type_, "value": value}
        if truncated:
            result["truncated"] = True
        return result

    def unavailable(self, value, reason):
        return {"kind": "unavailable", "type": type_name(value), "reason": reason}

    def value(self, value, depth=0):
        cls = type(value)
        if value is None:
            return self.scalar("NoneType", "None")
        if cls is bool:
            return self.scalar("bool", "True" if value else "False")
        if cls is int:
            if value.bit_length() > 13_000:
                return self.scalar("int", "<integer exceeds 13000 bits>", True)
            return self.scalar("int", str(value))
        if cls is float:
            return self.scalar("float", repr(value))
        if cls is complex:
            return self.scalar("complex", repr(value))
        if cls is str:
            return self.scalar("str", value[:MAX_STRING], len(value) > MAX_STRING)
        if cls is bytes:
            return self.scalar("bytes", repr(value[:1024]), len(value) > 1024)
        if cls is range:
            return self.scalar("range", repr(value))
        if cls in (types.FunctionType, types.BuiltinFunctionType, types.ModuleType, type):
            return self.unavailable(value, "Runtime metadata is not expanded")
        if depth >= MAX_DEPTH:
            return self.unavailable(value, "Maximum nesting depth reached")
        address = id(value)
        if address not in self.identities:
            if len(self.identities) >= MAX_IDENTITIES:
                return self.unavailable(value, "Object identity budget reached")
            self.identities[address] = (f"o{len(self.identities) + 1}", value)
        object_id = self.identities[address][0]
        ref = {"kind": "ref", "id": object_id}
        if object_id in self.objects:
            return ref
        if len(self.objects) >= MAX_OBJECTS:
            return self.unavailable(value, "Snapshot object budget reached")
        node = {"id": object_id, "type": type_name(value), "truncated": False}
        self.objects[object_id] = node
        if cls in (list, tuple, set, frozenset, deque):
            node["length"] = len(value)
            node["truncated"] = len(value) > MAX_ITEMS
            # Exact builtin types: no user-defined iteration methods are invoked.
            node["items"] = self.sequence(value, depth)
        elif cls in (dict, defaultdict, OrderedDict, Counter):
            node["length"] = len(value)
            node["truncated"] = len(value) > MAX_ITEMS
            node["entries"] = []
            for i, (key, item) in enumerate(OrderedDict.items(value) if cls is OrderedDict else dict.items(value)):
                if i == MAX_ITEMS:
                    break
                node["entries"].append({"key": self.value(key, depth + 1), "value": self.value(item, depth + 1)})
        else:
            attributes = self.safe_attributes(value)
            if attributes is None:
                del self.objects[object_id]
                return self.unavailable(value, "No supported data fields; custom getters and repr are not evaluated")
            node["attributes"] = {}
            node["truncated"] = len(attributes) > MAX_ITEMS
            for i, (name, item) in enumerate(attributes.items()):
                if i == MAX_ITEMS:
                    break
                if type(name) is str:
                    node["attributes"][name[:200]] = self.value(item, depth + 1)
        return ref

    def sequence(self, value, depth):
        result = []
        for i, item in enumerate(value):
            if i == MAX_ITEMS:
                break
            result.append(self.value(item, depth + 1))
        return result

    def safe_attributes(self, value):
        cls = type(value)
        # Bypass user __getattribute__. Only builtin data descriptors may be read.
        result = {}
        found = False
        for base in type.__dict__["__mro__"].__get__(cls):
            namespace = type.__dict__["__dict__"].__get__(base)
            descriptor = namespace.get("__dict__")
            if type(descriptor) is types.GetSetDescriptorType:
                data = descriptor.__get__(value, cls)
                if type(data) is dict:
                    result.update(data)
                    found = True
            for name, descriptor in namespace.items():
                if type(descriptor) is types.MemberDescriptorType:
                    try:
                        result[name] = descriptor.__get__(value, cls)
                        found = True
                    except AttributeError:
                        pass
        return result if found else None


def fingerprint(value, objects, seen=None):
    """Include reachable contents: a ref can change even when its ID stays fixed."""
    seen = set() if seen is None else seen
    if value.get("kind") != "ref":
        return value
    object_id = value["id"]
    if object_id in seen:
        return value
    seen.add(object_id)
    node = objects.get(object_id)
    if node is None:
        return value
    return {
        "ref": object_id,
        "type": node["type"],
        "truncated": node["truncated"],
        "length": node.get("length"),
        "items": [fingerprint(x, objects, seen) for x in node.get("items", [])],
        "entries": [[fingerprint(x["key"], objects, seen), fingerprint(x["value"], objects, seen)] for x in node.get("entries", [])],
        "attributes": {k: fingerprint(v, objects, seen) for k, v in node.get("attributes", {}).items()},
    }
