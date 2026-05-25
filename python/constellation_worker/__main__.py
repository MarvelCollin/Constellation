import json

from .hardware import snapshot

print(json.dumps(snapshot(), indent=2))
