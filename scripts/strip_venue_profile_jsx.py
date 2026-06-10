from pathlib import Path
import re

p = Path("src/app/dashboard/settings/sections/VenueProfileSection.tsx")
text = p.read_text(encoding="utf-8")
text2 = re.sub(
    r"      <SectionCard\.Body>\n        <div className=\"mb-6\">.*?</motion.div>\n\n        <form",
    "      <SectionCard.Body>\n        <form",
    text,
    count=1,
    flags=re.DOTALL,
)
if text2 == text:
    text2 = re.sub(
        r"      <SectionCard\.Body>\n        <div className=\"mb-6\">.*?</div>\n\n        <form",
        "      <SectionCard.Body>\n        <form",
        text,
        count=1,
        flags=re.DOTALL,
    )
# Remove duplicate name field if form was merged wrong
text2 = re.sub(
    r"(<input id=\"name\"[^/]*/>\n            \{errors\.name.*?\}\n          </motion.div>\n          <div>\n            <label htmlFor=\"name\")",
    r"\1",
    text2,
    count=1,
)
p.write_text(text2, encoding="utf-8")
print("chars removed:", len(text) - len(text2))
