CREATE TABLE public.skill_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  name text NOT NULL,
  description text,
  effort_hours numeric NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  market_weight numeric NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, name)
);
GRANT SELECT ON public.skill_nodes TO authenticated;
GRANT ALL ON public.skill_nodes TO service_role;
ALTER TABLE public.skill_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can view skill nodes" ON public.skill_nodes FOR SELECT TO authenticated USING (true);

CREATE TABLE public.skill_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id uuid NOT NULL REFERENCES public.skill_nodes(id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES public.skill_nodes(id) ON DELETE CASCADE,
  weight numeric NOT NULL DEFAULT 1.0,
  UNIQUE (from_node_id, to_node_id)
);
GRANT SELECT ON public.skill_edges TO authenticated;
GRANT ALL ON public.skill_edges TO service_role;
ALTER TABLE public.skill_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can view skill edges" ON public.skill_edges FOR SELECT TO authenticated USING (true);

CREATE TABLE public.diagnostic_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_node_id uuid NOT NULL REFERENCES public.skill_nodes(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  options jsonb NOT NULL,
  correct_option_id text NOT NULL,
  difficulty numeric NOT NULL DEFAULT 0.5
);
GRANT SELECT ON public.diagnostic_items TO authenticated;
GRANT ALL ON public.diagnostic_items TO service_role;
ALTER TABLE public.diagnostic_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can view diagnostic items" ON public.diagnostic_items FOR SELECT TO authenticated USING (true);

CREATE TABLE public.learner_skill_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_node_id uuid NOT NULL REFERENCES public.skill_nodes(id) ON DELETE CASCADE,
  p_mastery numeric NOT NULL DEFAULT 0.1,
  observation_count integer NOT NULL DEFAULT 0,
  last_practiced_at timestamptz,
  UNIQUE (user_id, skill_node_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learner_skill_state TO authenticated;
GRANT ALL ON public.learner_skill_state TO service_role;
ALTER TABLE public.learner_skill_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own skill state" ON public.learner_skill_state FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.learner_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_node_id uuid NOT NULL REFERENCES public.skill_nodes(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.diagnostic_items(id) ON DELETE SET NULL,
  correct boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learner_responses TO authenticated;
GRANT ALL ON public.learner_responses TO service_role;
ALTER TABLE public.learner_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own responses" ON public.learner_responses FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.learner_constraints (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_node_id uuid REFERENCES public.skill_nodes(id) ON DELETE SET NULL,
  goal_text text,
  daily_time_minutes integer,
  deadline_date date,
  completed_courses text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learner_constraints TO authenticated;
GRANT ALL ON public.learner_constraints TO service_role;
ALTER TABLE public.learner_constraints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own constraints" ON public.learner_constraints FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.plan_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  trigger text,
  summary text,
  reasoning text,
  node_snapshot jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_history TO authenticated;
GRANT ALL ON public.plan_history TO service_role;
ALTER TABLE public.plan_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own plan history" ON public.plan_history FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

INSERT INTO public.skill_nodes (domain, name, description, effort_hours, is_required, market_weight) VALUES
('java_backend','Java Syntax Basics','Variables, control flow, methods, and the core language grammar you write every day.',15,true,0.6),
('java_backend','Git & Version Control','Branching, merging, rebasing, and collaborating on a shared codebase.',8,true,0.7),
('java_backend','Linux CLI Basics','Shell navigation, permissions, processes, logs, and piping tools together.',8,true,0.5),
('java_backend','OOP Design Principles','Encapsulation, inheritance, composition, interfaces, and SOLID in practice.',20,true,0.7),
('java_backend','Exception Handling','Checked vs unchecked exceptions, try-with-resources, and failure design.',6,true,0.5),
('java_backend','Collections & Generics','Lists, maps, sets, iteration order, equality contracts, and type parameters.',12,true,0.7),
('java_backend','Multithreading & Concurrency','Threads, executors, locks, the memory model, and safe shared state.',18,true,0.8),
('java_backend','SQL Fundamentals','Joins, aggregation, indexes, transactions, and query shape.',15,true,0.9),
('java_backend','JDBC & Database Connectivity','Connections, pooling, prepared statements, and mapping rows to objects.',10,true,0.6),
('java_backend','REST API Design','Resources, verbs, status codes, versioning, pagination, and contracts.',12,true,0.9),
('java_backend','Spring Core (DI/IoC)','Beans, the container, dependency injection, scopes, and configuration.',15,true,0.8),
('java_backend','Spring Boot','Auto-configuration, starters, profiles, and building a running service.',20,true,1.0),
('java_backend','Spring Security & Auth (JWT)','Filters, authentication, authorization, and stateless token-based auth.',15,true,0.9),
('java_backend','Testing (JUnit/Mockito)','Unit tests, mocks, slices, and integration tests you can trust.',10,true,0.8),
('java_backend','Docker Basics','Images, layers, containers, volumes, and shipping a service reproducibly.',10,false,0.7),
('java_backend','Build & Deploy a Backend Service (capstone)','Bring it together: a secured, tested, containerised service running in the wild.',20,true,1.0);

INSERT INTO public.skill_edges (from_node_id, to_node_id, weight)
SELECT f.id, t.id, e.weight
FROM (VALUES
  ('Java Syntax Basics','OOP Design Principles',1.0),
  ('Java Syntax Basics','Exception Handling',1.0),
  ('OOP Design Principles','Collections & Generics',1.0),
  ('Collections & Generics','Multithreading & Concurrency',1.0),
  ('OOP Design Principles','Spring Core (DI/IoC)',1.0),
  ('SQL Fundamentals','JDBC & Database Connectivity',1.0),
  ('Spring Core (DI/IoC)','Spring Boot',1.0),
  ('JDBC & Database Connectivity','Spring Boot',1.0),
  ('REST API Design','Spring Boot',0.6),
  ('Multithreading & Concurrency','Spring Boot',0.4),
  ('Spring Boot','Spring Security & Auth (JWT)',1.0),
  ('Spring Boot','Testing (JUnit/Mockito)',1.0),
  ('Spring Boot','Docker Basics',0.5),
  ('Spring Security & Auth (JWT)','Build & Deploy a Backend Service (capstone)',1.0),
  ('Testing (JUnit/Mockito)','Build & Deploy a Backend Service (capstone)',1.0),
  ('Docker Basics','Build & Deploy a Backend Service (capstone)',0.5)
) AS e(from_name, to_name, weight)
JOIN public.skill_nodes f ON f.name = e.from_name AND f.domain = 'java_backend'
JOIN public.skill_nodes t ON t.name = e.to_name AND t.domain = 'java_backend';

INSERT INTO public.diagnostic_items (skill_node_id, question_text, options, correct_option_id, difficulty)
SELECT n.id, q.question_text, q.options::jsonb, q.correct_option_id, q.difficulty
FROM (VALUES
  ('Java Syntax Basics','Which declaration creates a constant that cannot be reassigned?','[{"id":"a","text":"const int x = 5;"},{"id":"b","text":"final int x = 5;"},{"id":"c","text":"static int x = 5;"},{"id":"d","text":"readonly int x = 5;"}]','b',0.2),
  ('Java Syntax Basics','What is printed by: System.out.println(10 / 4);','[{"id":"a","text":"2.5"},{"id":"b","text":"2"},{"id":"c","text":"3"},{"id":"d","text":"Compilation error"}]','b',0.5),
  ('Java Syntax Basics','Given String s = "ab"; s.concat("c"); System.out.println(s); what is printed?','[{"id":"a","text":"abc"},{"id":"b","text":"ab"},{"id":"c","text":"c"},{"id":"d","text":"null"}]','b',0.5),
  ('Java Syntax Basics','Which statement about the switch expression (Java 14+) is true?','[{"id":"a","text":"Arrow labels fall through by default"},{"id":"b","text":"It cannot return a value"},{"id":"c","text":"yield returns a value from a block-bodied case"},{"id":"d","text":"It only supports int cases"}]','c',0.8),
  ('OOP Design Principles','Which principle says a class should have one reason to change?','[{"id":"a","text":"Open/Closed Principle"},{"id":"b","text":"Single Responsibility Principle"},{"id":"c","text":"Liskov Substitution Principle"},{"id":"d","text":"Interface Segregation Principle"}]','b',0.2),
  ('OOP Design Principles','You need behaviour reuse without locking a rigid type hierarchy. What do you prefer?','[{"id":"a","text":"Deep inheritance chains"},{"id":"b","text":"Composition with injected collaborators"},{"id":"c","text":"Static utility classes"},{"id":"d","text":"Protected fields shared with subclasses"}]','b',0.5),
  ('OOP Design Principles','A subclass overrides a method and throws UnsupportedOperationException for valid parent inputs. Which principle is violated?','[{"id":"a","text":"Liskov Substitution"},{"id":"b","text":"Dependency Inversion"},{"id":"c","text":"Single Responsibility"},{"id":"d","text":"Encapsulation"}]','a',0.8),
  ('OOP Design Principles','Dependency Inversion primarily says high-level modules should depend on:','[{"id":"a","text":"Concrete low-level classes"},{"id":"b","text":"Abstractions"},{"id":"c","text":"Static singletons"},{"id":"d","text":"The framework container"}]','b',0.5),
  ('Multithreading & Concurrency','What does the volatile keyword guarantee?','[{"id":"a","text":"Atomic compound operations"},{"id":"b","text":"Visibility of writes across threads"},{"id":"c","text":"Mutual exclusion"},{"id":"d","text":"Thread priority"}]','b',0.5),
  ('Multithreading & Concurrency','Which is safe for concurrent reads and writes from many threads?','[{"id":"a","text":"HashMap"},{"id":"b","text":"ArrayList"},{"id":"c","text":"ConcurrentHashMap"},{"id":"d","text":"LinkedList"}]','c',0.2),
  ('Multithreading & Concurrency','Two threads lock A then B, and B then A. What is the likely failure?','[{"id":"a","text":"Livelock"},{"id":"b","text":"Deadlock"},{"id":"c","text":"Starvation"},{"id":"d","text":"Race on the CPU cache only"}]','b',0.5),
  ('Multithreading & Concurrency','Why can an unsynchronised i++ lose updates even with volatile?','[{"id":"a","text":"volatile disables caching entirely"},{"id":"b","text":"Increment is read-modify-write, which is not atomic"},{"id":"c","text":"The JIT reorders volatile writes"},{"id":"d","text":"int is not thread-confined"}]','b',0.8),
  ('SQL Fundamentals','Which join keeps rows from the left table with no match on the right?','[{"id":"a","text":"INNER JOIN"},{"id":"b","text":"LEFT JOIN"},{"id":"c","text":"CROSS JOIN"},{"id":"d","text":"NATURAL JOIN"}]','b',0.2),
  ('SQL Fundamentals','Which clause filters rows AFTER aggregation?','[{"id":"a","text":"WHERE"},{"id":"b","text":"HAVING"},{"id":"c","text":"GROUP BY"},{"id":"d","text":"ORDER BY"}]','b',0.5),
  ('SQL Fundamentals','A query filters on (status, created_at). Which index helps most?','[{"id":"a","text":"Separate index on created_at only"},{"id":"b","text":"Composite index on (status, created_at)"},{"id":"c","text":"Composite index on (created_at, id)"},{"id":"d","text":"No index; the planner scans faster"}]','b',0.8),
  ('SQL Fundamentals','What does an isolation level of READ COMMITTED prevent?','[{"id":"a","text":"Dirty reads"},{"id":"b","text":"Phantom reads"},{"id":"c","text":"Non-repeatable reads"},{"id":"d","text":"All anomalies"}]','a',0.8),
  ('REST API Design','Which status code should a successful resource creation return?','[{"id":"a","text":"200 OK"},{"id":"b","text":"201 Created"},{"id":"c","text":"204 No Content"},{"id":"d","text":"302 Found"}]','b',0.2),
  ('REST API Design','Which HTTP method is idempotent and replaces a whole resource?','[{"id":"a","text":"POST"},{"id":"b","text":"PATCH"},{"id":"c","text":"PUT"},{"id":"d","text":"HEAD"}]','c',0.5),
  ('REST API Design','A client sends a valid request but lacks permission. Best status?','[{"id":"a","text":"400 Bad Request"},{"id":"b","text":"401 Unauthorized"},{"id":"c","text":"403 Forbidden"},{"id":"d","text":"422 Unprocessable Entity"}]','c',0.5),
  ('REST API Design','For a large, frequently changing collection, which pagination scales best?','[{"id":"a","text":"OFFSET/LIMIT paging"},{"id":"b","text":"Cursor (keyset) paging"},{"id":"c","text":"Loading all rows client-side"},{"id":"d","text":"Random sampling"}]','b',0.8),
  ('Spring Boot','What does @SpringBootApplication combine?','[{"id":"a","text":"@Configuration, @EnableAutoConfiguration, @ComponentScan"},{"id":"b","text":"@Service, @Repository, @Controller"},{"id":"c","text":"@Bean, @Value, @Profile"},{"id":"d","text":"@Entity, @Table, @Id"}]','a',0.2),
  ('Spring Boot','Where do you put environment-specific settings activated by a profile?','[{"id":"a","text":"application-{profile}.yml"},{"id":"b","text":"pom.xml only"},{"id":"c","text":"A static block in main()"},{"id":"d","text":"META-INF/MANIFEST.MF"}]','a',0.5),
  ('Spring Boot','Which annotation loads only the web layer with mocked collaborators in a test?','[{"id":"a","text":"@SpringBootTest"},{"id":"b","text":"@WebMvcTest"},{"id":"c","text":"@DataJpaTest"},{"id":"d","text":"@ContextConfiguration"}]','b',0.5),
  ('Spring Boot','Your custom DataSource bean is ignored in favour of the auto-configured one. Most likely cause?','[{"id":"a","text":"Auto-configuration always wins over user beans"},{"id":"b","text":"Your bean is not picked up by component scanning or is conditionally excluded"},{"id":"c","text":"Spring Boot forbids custom DataSource beans"},{"id":"d","text":"DataSource must be declared in application.yml only"}]','b',0.8)
) AS q(node_name, question_text, options, correct_option_id, difficulty)
JOIN public.skill_nodes n ON n.name = q.node_name AND n.domain = 'java_backend';