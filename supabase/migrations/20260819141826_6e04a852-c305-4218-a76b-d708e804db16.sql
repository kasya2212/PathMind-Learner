
-- 1. Fine-grained OOP sub-skills so a goal like "OOP Design Principles" yields an OOP-relevant graph
INSERT INTO public.skill_nodes (domain, name, description, effort_hours, is_required, market_weight)
VALUES
  ('java_backend','Classes & Objects','Defining classes, fields, constructors and instantiating objects in Java.',6,true,0.7),
  ('java_backend','Encapsulation','Hiding internal state behind accessors and keeping invariants inside the object.',5,true,0.7),
  ('java_backend','Inheritance','Extending classes, overriding behaviour and understanding the class hierarchy.',6,true,0.7),
  ('java_backend','Polymorphism','Dynamic dispatch, method overriding vs overloading and programming to interfaces.',7,true,0.75),
  ('java_backend','Abstraction','Abstract classes and interfaces to model behaviour without implementation detail.',5,true,0.7)
ON CONFLICT DO NOTHING;

-- 2. Prerequisite edges for the OOP chain
DELETE FROM public.skill_edges
WHERE from_node_id = (SELECT id FROM public.skill_nodes WHERE name='Java Syntax Basics')
  AND to_node_id = (SELECT id FROM public.skill_nodes WHERE name='OOP Design Principles');

INSERT INTO public.skill_edges (from_node_id, to_node_id, weight)
SELECT f.id, t.id, e.w
FROM (VALUES
  ('Java Syntax Basics','Classes & Objects',1.0),
  ('Classes & Objects','Encapsulation',1.0),
  ('Classes & Objects','Abstraction',1.0),
  ('Encapsulation','Inheritance',1.0),
  ('Inheritance','Polymorphism',1.0),
  ('Abstraction','Polymorphism',0.8),
  ('Polymorphism','OOP Design Principles',1.0),
  ('Encapsulation','OOP Design Principles',1.0),
  ('Abstraction','OOP Design Principles',1.0)
) AS e(fromn, ton, w)
JOIN public.skill_nodes f ON f.name = e.fromn
JOIN public.skill_nodes t ON t.name = e.ton
WHERE NOT EXISTS (
  SELECT 1 FROM public.skill_edges x WHERE x.from_node_id = f.id AND x.to_node_id = t.id
);

-- 3. Diagnostic items for the new nodes
INSERT INTO public.diagnostic_items (skill_node_id, question_text, options, correct_option_id, difficulty)
SELECT n.id, q.question, q.options::jsonb, q.correct, q.difficulty
FROM (VALUES
  ('Classes & Objects','Which keyword creates a new instance of a class in Java?','[{"id":"a","text":"new"},{"id":"b","text":"instance"},{"id":"c","text":"create"},{"id":"d","text":"alloc"}]','a',0.2),
  ('Classes & Objects','What is a constructor?','[{"id":"a","text":"A method that returns the class name"},{"id":"b","text":"A special method run when an object is created"},{"id":"c","text":"A static initialiser for the JVM"},{"id":"d","text":"A field holding the object identity"}]','b',0.35),
  ('Classes & Objects','What does the `this` reference point to inside an instance method?','[{"id":"a","text":"The superclass"},{"id":"b","text":"The class object"},{"id":"c","text":"The current instance"},{"id":"d","text":"A static singleton"}]','c',0.45),
  ('Encapsulation','Which access modifier best supports encapsulation for fields?','[{"id":"a","text":"public"},{"id":"b","text":"private"},{"id":"c","text":"protected"},{"id":"d","text":"default"}]','b',0.25),
  ('Encapsulation','Why expose a getter instead of a public field?','[{"id":"a","text":"It runs faster"},{"id":"b","text":"It lets the class validate and evolve its internals"},{"id":"c","text":"It is required by the JVM"},{"id":"d","text":"It reduces memory use"}]','b',0.45),
  ('Encapsulation','Returning a direct reference to an internal mutable List from a getter is risky because:','[{"id":"a","text":"It copies the list"},{"id":"b","text":"Callers can mutate internal state and break invariants"},{"id":"c","text":"It throws at runtime"},{"id":"d","text":"Generics are erased"}]','b',0.7),
  ('Inheritance','Which keyword makes one class inherit from another?','[{"id":"a","text":"implements"},{"id":"b","text":"extends"},{"id":"c","text":"inherits"},{"id":"d","text":"derives"}]','b',0.2),
  ('Inheritance','What does `super()` do in a constructor?','[{"id":"a","text":"Calls the parent class constructor"},{"id":"b","text":"Creates a static instance"},{"id":"c","text":"Clones the object"},{"id":"d","text":"Marks the class final"}]','a',0.4),
  ('Inheritance','Composition is often preferred over inheritance because:','[{"id":"a","text":"It is faster at runtime"},{"id":"b","text":"It avoids fragile base-class coupling"},{"id":"c","text":"Java forbids deep hierarchies"},{"id":"d","text":"It removes the need for interfaces"}]','b',0.7),
  ('Polymorphism','Method overriding differs from overloading because overriding:','[{"id":"a","text":"Changes the parameter list in the same class"},{"id":"b","text":"Replaces a superclass method with the same signature"},{"id":"c","text":"Only works on static methods"},{"id":"d","text":"Requires generics"}]','b',0.45),
  ('Polymorphism','Calling an overridden method through a superclass reference resolves to:','[{"id":"a","text":"The superclass implementation"},{"id":"b","text":"The runtime type''s implementation"},{"id":"c","text":"A compile error"},{"id":"d","text":"The first interface method"}]','b',0.6),
  ('Polymorphism','Which of these is NOT polymorphic dispatch in Java?','[{"id":"a","text":"Overridden instance methods"},{"id":"b","text":"Interface default methods"},{"id":"c","text":"Static methods hidden in a subclass"},{"id":"d","text":"Abstract method implementations"}]','c',0.8),
  ('Abstraction','An abstract class in Java:','[{"id":"a","text":"Cannot be instantiated directly"},{"id":"b","text":"Cannot hold fields"},{"id":"c","text":"Must implement every method"},{"id":"d","text":"Is the same as an interface"}]','a',0.3),
  ('Abstraction','A key difference between an interface and an abstract class is:','[{"id":"a","text":"Interfaces cannot declare methods"},{"id":"b","text":"A class can implement many interfaces but extend one class"},{"id":"c","text":"Abstract classes cannot have constructors"},{"id":"d","text":"Interfaces are always final"}]','b',0.5),
  ('Abstraction','Programming to an interface mainly improves:','[{"id":"a","text":"Bytecode size"},{"id":"b","text":"Substitutability and testability of implementations"},{"id":"c","text":"Garbage collection"},{"id":"d","text":"Thread safety"}]','b',0.65)
) AS q(node, question, options, correct, difficulty)
JOIN public.skill_nodes n ON n.name = q.node
WHERE NOT EXISTS (
  SELECT 1 FROM public.diagnostic_items d WHERE d.skill_node_id = n.id AND d.question_text = q.question
);

-- 4. Track BKT before/after mastery on each observation
ALTER TABLE public.learner_responses
  ADD COLUMN IF NOT EXISTS previous_mastery numeric,
  ADD COLUMN IF NOT EXISTS new_mastery numeric;

-- 5. AI-generated bridge modules for hidden gaps
CREATE TABLE IF NOT EXISTS public.bridge_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_node_id uuid NOT NULL REFERENCES public.skill_nodes(id) ON DELETE CASCADE,
  goal_node_id uuid REFERENCES public.skill_nodes(id) ON DELETE SET NULL,
  title text NOT NULL,
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_modules TO authenticated;
GRANT ALL ON public.bridge_modules TO service_role;
ALTER TABLE public.bridge_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own bridge modules" ON public.bridge_modules;
CREATE POLICY "Users manage own bridge modules" ON public.bridge_modules
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
