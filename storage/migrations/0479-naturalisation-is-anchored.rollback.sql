-- Back to unanchored, which is how it shipped and how it cannot score.
DELETE FROM criterion_scale_anchor
WHERE  criterion IN (SELECT id FROM criterion WHERE attribute = 'country.naturalisation_pathway');
